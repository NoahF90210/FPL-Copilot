from __future__ import annotations

import json
import math
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import Select, desc, select
from data.fpl_client import get_bootstrap, get_fixtures, get_prediction_gameweek
from data.identity import INTEGRITY_VERSION, fixture_fingerprint, roster_fingerprint, validate_bootstrap, validate_fixtures
from sqlalchemy.orm import Session

from core.config import get_settings
from database.models import Fixture, ModelPrediction, PipelineRun, Player, PlayerGameweekStat, Team, TeamGameweekStat


settings = get_settings()


def upsert_model(session: Session, model: Any, defaults: dict[str, Any], **identity: Any) -> tuple[Any, bool]:
    instance = session.execute(select(model).filter_by(**identity)).scalar_one_or_none()
    created = instance is None
    if instance is None:
        instance = model(**identity, **defaults)
        session.add(instance)
    else:
        for key, value in defaults.items():
            setattr(instance, key, value)
    return instance, created


def save_pipeline_run(
    session: Session,
    *,
    run_type: str,
    status: str,
    source_endpoints: list[str] | None = None,
    rows_inserted: int = 0,
    rows_updated: int = 0,
    metadata_json: dict[str, Any] | None = None,
    error_message: str | None = None,
    started_at: datetime | None = None,
    completed_at: datetime | None = None,
) -> PipelineRun:
    run = PipelineRun(
        run_type=run_type,
        status=status,
        source_endpoints=source_endpoints,
        rows_inserted=rows_inserted,
        rows_updated=rows_updated,
        metadata_json=metadata_json,
        error_message=error_message,
        started_at=started_at or datetime.now(timezone.utc),
        completed_at=completed_at,
    )
    session.add(run)
    session.flush()
    return run


def latest_pipeline_run(session: Session, run_type: str | None = None) -> PipelineRun | None:
    stmt: Select[tuple[PipelineRun]] = select(PipelineRun).order_by(desc(PipelineRun.started_at))
    if run_type:
        stmt = stmt.where(PipelineRun.run_type == run_type)
    stmt = stmt.limit(1)
    return session.execute(stmt).scalar_one_or_none()


def latest_prediction_metadata(session: Session) -> ModelPrediction | None:
    stmt = select(ModelPrediction).order_by(
        desc(ModelPrediction.prediction_timestamp),
        desc(ModelPrediction.target_gameweek),
    )
    stmt = stmt.limit(1)
    return session.execute(stmt).scalar_one_or_none()


def latest_model_version(session: Session) -> str | None:
    latest = latest_prediction_metadata(session)
    return latest.model_version if latest else None


def verified_roster(session: Session) -> tuple[PipelineRun | None, list[Player]]:
    ingestion = session.execute(
        select(PipelineRun).where(
            PipelineRun.run_type == "ingestion", PipelineRun.status == "success",
        ).order_by(PipelineRun.started_at.desc(), PipelineRun.id.desc()).limit(1)
    ).scalar_one_or_none()
    metadata = ingestion.metadata_json if ingestion else None
    if not isinstance(metadata, dict) or metadata.get("integrity_version") != INTEGRITY_VERSION:
        return None, []
    players = list(session.scalars(select(Player).where(Player.is_current.is_(True))))
    positions = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}
    if not players or any(
        p.season != metadata.get("season") or p.fpl_code is None
        or p.position != positions.get(p.position_id)
        or p.full_name != f"{p.first_name} {p.second_name}" for p in players
    ):
        return None, []
    identities = [dict(id=p.id, code=p.fpl_code, first_name=p.first_name,
                       second_name=p.second_name, team=p.team_id, element_type=p.position_id,
                       web_name=p.web_name)
                  for p in players]
    if (len(players) != metadata.get("roster_count")
            or roster_fingerprint(identities) != metadata.get("roster_fingerprint")):
        return None, []
    return ingestion, players


def verified_schedule(session: Session, ingestion: PipelineRun) -> list[dict]:
    rows = list(session.scalars(select(Fixture).where(Fixture.is_current.is_(True))))
    if not rows or any(row.season != ingestion.metadata_json["season"] for row in rows):
        return []
    fixtures = [dict(id=f.id, event=f.gameweek, team_h=f.team_h, team_a=f.team_a,
                     kickoff_time=f.kickoff_time, finished=f.finished,
                     team_h_difficulty=f.team_h_difficulty, team_a_difficulty=f.team_a_difficulty)
                for f in rows]
    return fixtures if fixture_fingerprint(fixtures) == ingestion.metadata_json.get("fixture_fingerprint") else []


def official_snapshot_matches(ingestion: PipelineRun, roster: list[Player],
                             bootstrap: dict, fixtures: list[dict]) -> bool:
    season = validate_bootstrap(bootstrap)
    validate_fixtures(fixtures, bootstrap)
    metadata = ingestion.metadata_json
    if (metadata.get("season") != season
            or metadata.get("roster_fingerprint") != roster_fingerprint(bootstrap["elements"])
            or metadata.get("fixture_fingerprint") != fixture_fingerprint(fixtures)):
        return False
    official = {p["id"]: p for p in bootstrap["elements"]}
    return all(p.id in official and p.status == official[p.id].get("status", "a") for p in roster)


def utc_timestamp(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def verified_prediction_batch(session: Session, *, bootstrap: dict | None = None,
                              fixtures: list[dict] | None = None,
                              now: datetime | None = None, max_age_hours: float = 36) -> dict[int, ModelPrediction]:
    ingestion, roster = verified_roster(session)
    latest = latest_prediction_metadata(session)
    training = latest_pipeline_run(session, "training")
    if ingestion is None or latest is None or training is None or training.status != "success":
        return {}
    if not verified_schedule(session, ingestion):
        return {}
    bootstrap = get_bootstrap() if bootstrap is None else bootstrap
    fixtures = get_fixtures() if fixtures is None else fixtures
    if not official_snapshot_matches(ingestion, roster, bootstrap, fixtures):
        return {}
    target = get_prediction_gameweek(bootstrap)
    now = utc_timestamp(now or datetime.now(timezone.utc))

    def fresh(value: datetime | None) -> bool:
        return value is not None and -timedelta(minutes=5) <= now - utc_timestamp(value) <= timedelta(hours=max_age_hours)

    if (not fresh(ingestion.completed_at) or not fresh(training.completed_at)
            or (training.metadata_json or {}).get("ingestion_run_id") != ingestion.id
            or (training.metadata_json or {}).get("model_version") != latest.model_version):
        return {}
    rows = list(session.scalars(select(ModelPrediction).where(
        ModelPrediction.prediction_timestamp == latest.prediction_timestamp,
        ModelPrediction.model_version == latest.model_version,
        ModelPrediction.target_gameweek == latest.target_gameweek,
    )))
    eligible = {p.id: p for p in roster if p.status == "a"}
    if (len(rows) != len(eligible) or len(rows) != training.rows_inserted
            or {p.player_id for p in rows} != set(eligible)):
        return {}
    fixture_counts = {p.team_id: sum(
        f.get("event") == target and not f["finished"] and p.team_id in (f["team_h"], f["team_a"])
        for f in fixtures
    ) for p in roster}
    for row in rows:
        metadata = row.metadata_json or {}
        player = eligible[row.player_id]
        if (metadata.get("season") != player.season
                or metadata.get("player_code") != player.fpl_code
                or metadata.get("ingestion_run_id") != ingestion.id
                or metadata.get("target_fixture_count") != fixture_counts[player.team_id]
                or row.target_gameweek != target or not fresh(row.prediction_timestamp)
                or utc_timestamp(row.prediction_timestamp) < utc_timestamp(ingestion.completed_at)
                or utc_timestamp(row.prediction_timestamp) > utc_timestamp(training.completed_at)
                or not all(math.isfinite(value) and value >= 0
                           for value in (row.predicted_points, row.baseline_points))):
            return {}
    return {row.player_id: row for row in rows}


def fetch_players_with_predictions(session: Session) -> list[dict[str, Any]]:
    batch = verified_prediction_batch(session)
    if not batch:
        return []
    stmt = select(Player, Team).join(Team, Team.id == Player.team_id).where(Player.id.in_(batch))

    players: list[dict[str, Any]] = []
    for player, team in session.execute(stmt).all():
        prediction = batch[player.id]
        players.append(
            {
                "id": player.id,
                "player_code": player.fpl_code,
                "season": player.season,
                "name": player.web_name,
                "full_name": player.full_name,
                "team": team.name,
                "team_id": player.team_id,
                "team_short": team.short_name,
                "position": player.position,
                "position_id": player.position_id,
                "price": player.price,
                "form": player.form,
                "total_points": player.total_points,
                "selected_by_percent": player.selected_by_percent,
                "minutes": player.minutes,
                "goals_scored": player.goals_scored,
                "assists": player.assists,
                "clean_sheets": player.clean_sheets,
                "goals_conceded": player.goals_conceded,
                "yellow_cards": player.yellow_cards,
                "red_cards": player.red_cards,
                "saves": player.saves,
                "bonus": player.bonus,
                "bps": player.bps,
                "ict_index": player.ict_index,
                "influence": player.influence,
                "creativity": player.creativity,
                "threat": player.threat,
                "expected_goals": player.expected_goals,
                "expected_assists": player.expected_assists,
                "expected_goal_involvements": player.expected_goal_involvements,
                "chance_of_playing_next_round": player.chance_of_playing_next_round,
                "news": player.news,
                "status": player.status,
                "predicted_points": prediction.predicted_points if prediction else None,
                "baseline_points": prediction.baseline_points if prediction else None,
                "prediction_confidence": prediction.confidence if prediction else None,
                "model_version": prediction.model_version if prediction else None,
                "prediction_timestamp": prediction.prediction_timestamp.isoformat() if prediction else None,
                "target_gameweek": prediction.target_gameweek if prediction else None,
            }
        )
    return players


def fetch_latest_predictions(session: Session) -> list[dict[str, Any]]:
    players = fetch_players_with_predictions(session)
    return [player for player in players if player.get("predicted_points") is not None]


def fetch_upcoming_fixtures(
    session: Session,
    *,
    from_gameweek: int | None = None,
    season: str | None = None,
) -> dict[int, list[dict[str, Any]]]:
    stmt = select(Fixture).where(Fixture.finished.is_(False), Fixture.season == season,
                                 Fixture.is_current.is_(True))
    if from_gameweek is not None:
        stmt = stmt.where(Fixture.gameweek >= from_gameweek)
    stmt = stmt.order_by(Fixture.gameweek.asc(), Fixture.id.asc())
    fixtures = session.execute(stmt).scalars().all()
    upcoming: dict[int, list[dict[str, Any]]] = {}

    for fixture in fixtures:
        for side, opp_side, home in [("team_h", "team_a", True), ("team_a", "team_h", False)]:
            team_id = getattr(fixture, side)
            upcoming.setdefault(team_id, [])
            if len(upcoming[team_id]) >= 3:
                continue
            upcoming[team_id].append(
                {
                    "gameweek": fixture.gameweek,
                    "opponent_id": getattr(fixture, opp_side),
                    "home": home,
                    "fdr": fixture.team_h_difficulty if home else fixture.team_a_difficulty,
                }
            )
    return upcoming


def hydrate_prediction_context(session: Session, players: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    team_names = {team.id: team.short_name for team in session.execute(select(Team)).scalars().all()}
    player_rows = list(players)
    target_gameweeks: list[int] = []
    for player in player_rows:
        target = player.get("target_gameweek")
        if isinstance(target, int):
            target_gameweeks.append(target)
    target_gameweek = max(target_gameweeks) if target_gameweeks else None
    season = player_rows[0].get("season") if player_rows else None
    team_fixtures = fetch_upcoming_fixtures(session, from_gameweek=target_gameweek, season=season)
    hydrated = []

    for player in player_rows:
        next_fixtures = team_fixtures.get(player["team_id"], [])
        next_fixture = next_fixtures[0] if next_fixtures else None
        hydrated.append(
            {
                **player,
                "confidence": _prediction_confidence(player),
                "next_fdr": float(next_fixture["fdr"]) if next_fixture and next_fixture.get("fdr") is not None else 3.0,
                "next_home": next_fixture["home"] if next_fixture else False,
                "next_opponent": team_names.get(next_fixture["opponent_id"], "UNK") if next_fixture else "UNK",
                "next_fixtures": [
                    {**fixture, "opponent": team_names.get(fixture["opponent_id"], "UNK")}
                    for fixture in next_fixtures
                ],
            }
        )
    return hydrated


def _prediction_confidence(player: dict[str, Any]) -> str:
    minutes = player.get("minutes") or 0
    if minutes >= 1800:
        return "high"
    if minutes >= 900:
        return "medium"
    return "low"


def load_evaluation_report() -> dict[str, Any] | None:
    path = settings.evaluation_report_path
    if not path.exists():
        return None
    return json.loads(path.read_text())


def load_prediction_snapshot() -> dict[str, Any] | None:
    path = settings.latest_predictions_path
    if not path.exists():
        return None
    return json.loads(path.read_text())


def save_json_report(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))


def fetch_model_status(session: Session) -> dict[str, Any]:
    latest_ingestion = latest_pipeline_run(session, "ingestion")
    latest_training = latest_pipeline_run(session, "training")
    batch = verified_prediction_batch(session)
    latest_prediction = next(iter(batch.values()), None)
    report = (
        latest_training.metadata_json
        if latest_training and isinstance(latest_training.metadata_json, dict)
        else load_evaluation_report() or {}
    )
    latest_prediction_timestamp = (
        latest_prediction.prediction_timestamp.isoformat()
        if latest_prediction and latest_prediction.prediction_timestamp
        else None
    )
    latest_prediction_gameweek = (
        latest_prediction.target_gameweek
        if latest_prediction and latest_prediction.target_gameweek is not None
        else None
    )
    model_version = (
        latest_prediction.model_version
        if latest_prediction and latest_prediction.model_version
        else report.get("model_version")
    )

    return {
        "latest_ingestion_run": serialize_pipeline_summary(latest_ingestion),
        "latest_training_run": serialize_pipeline_summary(latest_training),
        "latest_prediction_timestamp": latest_prediction_timestamp,
        "latest_prediction_gameweek": latest_prediction_gameweek,
        "model_version": model_version,
        "evaluation": report,
        "database_status": "connected",
        "prediction_serving_mode": "database" if latest_prediction else "unavailable",
    }


def serialize_pipeline_summary(run: PipelineRun | None) -> dict[str, Any] | None:
    if run is None:
        return None
    return {
        "id": run.id,
        "run_type": run.run_type,
        "status": run.status,
        "source_endpoints": run.source_endpoints,
        "rows_inserted": run.rows_inserted,
        "rows_updated": run.rows_updated,
        "metadata_json": None,
        "error_message": None,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
    }


def serialize_pipeline_run(run: PipelineRun | None) -> dict[str, Any] | None:
    if run is None:
        return None
    return {
        "id": run.id,
        "run_type": run.run_type,
        "status": run.status,
        "source_endpoints": run.source_endpoints,
        "rows_inserted": run.rows_inserted,
        "rows_updated": run.rows_updated,
        "metadata_json": run.metadata_json,
        "error_message": run.error_message,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
    }
