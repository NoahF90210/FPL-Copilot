from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from data.fpl_client import get_bootstrap, get_current_gameweek, get_element_summary, get_fixtures
from database.models import Fixture, Player, PlayerGameweekStat, Team, TeamGameweekStat
from database.repository import save_pipeline_run, upsert_model


SOURCE_ENDPOINTS = [
    "/bootstrap-static",
    "/fixtures",
    "/element-summary/{player_id}",
]


def _to_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def run_ingestion(session: Session) -> dict[str, Any]:
    started_at = datetime.utcnow()
    rows_inserted = 0
    rows_updated = 0
    metadata: dict[str, Any] = {}

    try:
        bootstrap = get_bootstrap()
        fixtures = get_fixtures()
        current_gameweek = get_current_gameweek(bootstrap)
        metadata["current_gameweek"] = current_gameweek

        for team in bootstrap["teams"]:
            _, created = upsert_model(
                session,
                Team,
                {
                    "name": team["name"],
                    "short_name": team["short_name"],
                    "strength": team.get("strength"),
                    "strength_overall_home": team.get("strength_overall_home"),
                    "strength_overall_away": team.get("strength_overall_away"),
                    "strength_attack_home": team.get("strength_attack_home"),
                    "strength_attack_away": team.get("strength_attack_away"),
                    "strength_defence_home": team.get("strength_defence_home"),
                    "strength_defence_away": team.get("strength_defence_away"),
                },
                id=team["id"],
            )
            rows_inserted += int(created)
            rows_updated += int(not created)
        session.flush()

        players = bootstrap["elements"]

        for player in players:
            defaults = {
                "first_name": player["first_name"],
                "second_name": player["second_name"],
                "web_name": player["web_name"],
                "full_name": f"{player['first_name']} {player['second_name']}",
                "team_id": player["team"],
                "position": {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}.get(player["element_type"], "UNK"),
                "position_id": player["element_type"],
                "price": player["now_cost"] / 10,
                "form": _to_float(player.get("form")),
                "total_points": int(player.get("total_points", 0) or 0),
                "selected_by_percent": _to_float(player.get("selected_by_percent")),
                "minutes": int(player.get("minutes", 0) or 0),
                "goals_scored": int(player.get("goals_scored", 0) or 0),
                "assists": int(player.get("assists", 0) or 0),
                "clean_sheets": int(player.get("clean_sheets", 0) or 0),
                "goals_conceded": int(player.get("goals_conceded", 0) or 0),
                "yellow_cards": int(player.get("yellow_cards", 0) or 0),
                "red_cards": int(player.get("red_cards", 0) or 0),
                "saves": int(player.get("saves", 0) or 0),
                "bonus": int(player.get("bonus", 0) or 0),
                "bps": int(player.get("bps", 0) or 0),
                "ict_index": _to_float(player.get("ict_index")),
                "influence": _to_float(player.get("influence")),
                "creativity": _to_float(player.get("creativity")),
                "threat": _to_float(player.get("threat")),
                "expected_goals": _to_float(player.get("expected_goals")),
                "expected_assists": _to_float(player.get("expected_assists")),
                "expected_goal_involvements": _to_float(player.get("expected_goal_involvements")),
                "chance_of_playing_next_round": player.get("chance_of_playing_next_round"),
                "news": player.get("news", ""),
                "status": player.get("status", "a"),
            }
            _, created = upsert_model(session, Player, defaults, id=player["id"])
            rows_inserted += int(created)
            rows_updated += int(not created)
        session.flush()

        fixture_lookup: dict[int, Fixture] = {}
        for fixture in fixtures:
            fixture_model, created = upsert_model(
                session,
                Fixture,
                {
                    "gameweek": fixture.get("event"),
                    "kickoff_time": fixture.get("kickoff_time"),
                    "finished": bool(fixture.get("finished")),
                    "started": fixture.get("started"),
                    "team_h": fixture["team_h"],
                    "team_a": fixture["team_a"],
                    "team_h_score": fixture.get("team_h_score"),
                    "team_a_score": fixture.get("team_a_score"),
                    "team_h_difficulty": fixture.get("team_h_difficulty"),
                    "team_a_difficulty": fixture.get("team_a_difficulty"),
                },
                id=fixture["id"],
            )
            fixture_lookup[fixture["id"]] = fixture_model
            rows_inserted += int(created)
            rows_updated += int(not created)
        session.flush()

        team_agg: dict[tuple[int, int], dict[str, float]] = defaultdict(
            lambda: {
                "matches_played": 0,
                "total_points": 0.0,
                "total_minutes": 0.0,
                "total_goals": 0.0,
                "total_assists": 0.0,
                "total_clean_sheets": 0.0,
                "total_expected_goal_involvements": 0.0,
            }
        )

        for player in players:
            summary = get_element_summary(player["id"])
            for history in summary.get("history", []):
                gw = history.get("round")
                if not gw:
                    continue

                fixture_id = history.get("fixture")
                fixture = fixture_lookup.get(fixture_id) if fixture_id else None
                opponent_fdr = None
                if fixture is not None:
                    opponent_fdr = (
                        fixture.team_h_difficulty
                        if history.get("was_home")
                        else fixture.team_a_difficulty
                    )

                defaults = {
                    "team_id": player["team"],
                    "opponent_team_id": history.get("opponent_team"),
                    "gameweek": gw,
                    "was_home": bool(history.get("was_home")),
                    "minutes": int(history.get("minutes", 0) or 0),
                    "total_points": int(history.get("total_points", 0) or 0),
                    "goals_scored": int(history.get("goals_scored", 0) or 0),
                    "assists": int(history.get("assists", 0) or 0),
                    "clean_sheets": int(history.get("clean_sheets", 0) or 0),
                    "goals_conceded": int(history.get("goals_conceded", 0) or 0),
                    "own_goals": int(history.get("own_goals", 0) or 0),
                    "penalties_saved": int(history.get("penalties_saved", 0) or 0),
                    "penalties_missed": int(history.get("penalties_missed", 0) or 0),
                    "yellow_cards": int(history.get("yellow_cards", 0) or 0),
                    "red_cards": int(history.get("red_cards", 0) or 0),
                    "saves": int(history.get("saves", 0) or 0),
                    "bonus": int(history.get("bonus", 0) or 0),
                    "bps": int(history.get("bps", 0) or 0),
                    "influence": _to_float(history.get("influence")),
                    "creativity": _to_float(history.get("creativity")),
                    "threat": _to_float(history.get("threat")),
                    "ict_index": _to_float(history.get("ict_index")),
                    "value": _to_float(history.get("value")),
                    "selected": int(history.get("selected", 0) or 0),
                    "transfers_in": int(history.get("transfers_in", 0) or 0),
                    "transfers_out": int(history.get("transfers_out", 0) or 0),
                    "expected_goals": _to_float(history.get("expected_goals")),
                    "expected_assists": _to_float(history.get("expected_assists")),
                    "expected_goal_involvements": _to_float(history.get("expected_goal_involvements")),
                    "opponent_fdr": _to_float(opponent_fdr),
                }
                identity = {"player_id": player["id"], "fixture_id": fixture_id}
                if fixture_id is None:
                    defaults["fixture_id"] = fixture_id
                    identity = {"player_id": player["id"], "gameweek": gw}

                _, created = upsert_model(
                    session,
                    PlayerGameweekStat,
                    defaults,
                    **identity,
                )
                rows_inserted += int(created)
                rows_updated += int(not created)

                agg = team_agg[(player["team"], gw)]
                agg["matches_played"] = 1
                agg["total_points"] += int(history.get("total_points", 0) or 0)
                agg["total_minutes"] += int(history.get("minutes", 0) or 0)
                agg["total_goals"] += int(history.get("goals_scored", 0) or 0)
                agg["total_assists"] += int(history.get("assists", 0) or 0)
                agg["total_clean_sheets"] += int(history.get("clean_sheets", 0) or 0)
                agg["total_expected_goal_involvements"] += _to_float(
                    history.get("expected_goal_involvements")
                )

        for (team_id, gameweek), agg in team_agg.items():
            _, created = upsert_model(
                session,
                TeamGameweekStat,
                {
                    "matches_played": int(agg["matches_played"]),
                    "total_points": int(agg["total_points"]),
                    "total_minutes": int(agg["total_minutes"]),
                    "total_goals": int(agg["total_goals"]),
                    "total_assists": int(agg["total_assists"]),
                    "total_clean_sheets": int(agg["total_clean_sheets"]),
                    "total_expected_goal_involvements": float(agg["total_expected_goal_involvements"]),
                },
                team_id=team_id,
                gameweek=gameweek,
            )
            rows_inserted += int(created)
            rows_updated += int(not created)

        save_pipeline_run(
            session,
            run_type="ingestion",
            status="success",
            source_endpoints=SOURCE_ENDPOINTS,
            rows_inserted=rows_inserted,
            rows_updated=rows_updated,
            metadata_json=metadata,
            started_at=started_at,
            completed_at=datetime.utcnow(),
        )
        session.commit()
        return {
            "status": "success",
            "current_gameweek": current_gameweek,
            "rows_inserted": rows_inserted,
            "rows_updated": rows_updated,
        }
    except Exception as exc:
        session.rollback()
        session.expunge_all()
        save_pipeline_run(
            session,
            run_type="ingestion",
            status="failed",
            source_endpoints=SOURCE_ENDPOINTS,
            rows_inserted=rows_inserted,
            rows_updated=rows_updated,
            metadata_json=metadata,
            error_message=str(exc),
            started_at=started_at,
            completed_at=datetime.utcnow(),
        )
        session.commit()
        raise
