"""
Points prediction model.

Uses a weighted scoring formula:
  predicted_pts = (form * 0.4) + (ict_norm * 0.3) + (minutes_ratio * 0.2) + (fdr_inv * 0.1)
"""
from __future__ import annotations

from data.fpl_client import (
    get_bootstrap,
    get_fixtures,
    get_element_summary,
    build_player_list,
    get_next_fixture_fdr,
    get_current_gameweek,
)

# Position scoring multipliers for the formula
_POS_MULTIPLIER = {"GKP": 0.7, "DEF": 0.85, "MID": 1.0, "FWD": 1.05}

# Minutes threshold to consider a player a regular starter
_MINUTES_PER_GW = 90


def _fixture_difficulty_lookup(fixtures: list[dict]) -> dict[tuple[int, int, int, bool], float]:
    lookup: dict[tuple[int, int, int, bool], float] = {}
    for fixture in fixtures:
        gw = fixture.get("event")
        if not gw:
            continue

        home_team = fixture["team_h"]
        away_team = fixture["team_a"]
        lookup[(home_team, gw, away_team, True)] = float(fixture["team_h_difficulty"])
        lookup[(away_team, gw, home_team, False)] = float(fixture["team_a_difficulty"])
    return lookup


def _confidence(minutes: int, gameweeks_played: int) -> str:
    if gameweeks_played == 0:
        return "low"
    avg = minutes / gameweeks_played
    if avg >= 70:
        return "high"
    if avg >= 45:
        return "medium"
    return "low"


def _fallback_score(player: dict, fdr: float, minutes: int, gws_played: int) -> float:
    form = player["form"]
    ict = player["ict_index"]
    # Normalise ICT to ~0-1 range (typical max ~400 season)
    ict_norm = min(ict / 400.0, 1.0) if ict else 0.0
    minutes_ratio = (minutes / (gws_played * _MINUTES_PER_GW)) if gws_played else 0.0
    minutes_ratio = min(minutes_ratio, 1.0)
    fdr_inv = (6.0 - fdr) / 5.0  # FDR 1→1.0, FDR 5→0.2
    pos_mult = _POS_MULTIPLIER.get(player["position"], 1.0)
    raw = (form * 0.4) + (ict_norm * 0.3) + (minutes_ratio * 0.2) + (fdr_inv * 0.1)
    return round(raw * pos_mult * 5, 2)  # scale to realistic pts range


def _historical_form(history: list[dict], gw: int, fallback_form: float) -> float:
    prior = [h for h in history if h.get("round", 0) < gw]
    if not prior:
        return fallback_form

    recent = prior[-5:]
    points = [h.get("total_points", 0) for h in recent]
    return sum(points) / len(points) if points else fallback_form


def _historical_minutes(history: list[dict], gw: int) -> int:
    prior = [h for h in history if h.get("round", 0) < gw]
    return sum(h.get("minutes", 0) for h in prior)


def _historical_fdr(
    team_id: int,
    gw_history: list[dict],
    fixture_lookup: dict[tuple[int, int, int, bool], float],
) -> float:
    if not gw_history:
        return 3.0

    fdrs = []
    for appearance in gw_history:
        key = (
            team_id,
            appearance.get("round"),
            appearance.get("opponent_team"),
            bool(appearance.get("was_home")),
        )
        fdr = fixture_lookup.get(key)
        if fdr is not None:
            fdrs.append(fdr)

    if not fdrs:
        return 3.0
    return sum(fdrs) / len(fdrs)




def predict_players() -> list[dict]:
    bootstrap = get_bootstrap()
    fixtures = get_fixtures()
    players = build_player_list(bootstrap)
    team_fixtures = get_next_fixture_fdr(bootstrap, fixtures)
    team_map = {t["id"]: t["short_name"] for t in bootstrap["teams"]}
    current_gw = get_current_gameweek(bootstrap)

    results = []
    for player in players:
        team_id = player["team_id"]
        next_fixtures = team_fixtures.get(team_id, [])

        if not next_fixtures:
            fdr = 3.0
            home = False
        else:
            fdr = float(next_fixtures[0]["fdr"])
            home = next_fixtures[0]["home"]

        gws_played = current_gw - 1 if current_gw > 1 else 1
        minutes = player["minutes"]
        confidence = _confidence(minutes, gws_played)

        predicted_points = _fallback_score(player, fdr, minutes, gws_played)
        model_used = "formula"

        opponent_team_id = next_fixtures[0]["opponent_id"] if next_fixtures else None
        opponent = team_map.get(opponent_team_id, "UNK") if opponent_team_id else "UNK"

        results.append({
            **player,
            "predicted_points": predicted_points,
            "confidence": confidence,
            "model_used": model_used,
            "next_fdr": fdr,
            "next_home": home,
            "next_opponent": opponent,
            "next_fixtures": next_fixtures[:3],
        })

    results.sort(key=lambda x: x["predicted_points"], reverse=True)
    return results


def backtest_predictions() -> dict:
    """
    Compare predicted vs actual for the last 5 completed GWs.
    Uses the same formula model as live predictions with historical inputs.
    Returns MAE per GW and overall.
    """
    bootstrap = get_bootstrap()
    fixtures = get_fixtures()
    current_gw = get_current_gameweek(bootstrap)
    players = build_player_list(bootstrap)
    fixture_lookup = _fixture_difficulty_lookup(fixtures)

    gw_maes = []
    for gw_offset in range(1, 6):
        gw = current_gw - gw_offset
        if gw < 1:
            break

        errors = []
        evaluated = 0
        skipped = 0
        failed = 0

        for player in players:
            try:
                summary = get_element_summary(player["id"])
                history = summary.get("history", [])
                gw_hist = [h for h in history if h.get("round") == gw]
                if not gw_hist:
                    skipped += 1
                    continue

                actual = sum(h.get("total_points", 0) for h in gw_hist)
                prior_form = _historical_form(history, gw, player["form"])
                prior_minutes = _historical_minutes(history, gw)
                historical_fdr = _historical_fdr(player["team_id"], gw_hist, fixture_lookup)

                pred = _fallback_score(
                    {**player, "form": prior_form},
                    fdr=historical_fdr,
                    minutes=prior_minutes,
                    gws_played=max(gw - 1, 1),
                )
                errors.append(abs(pred - actual))
                evaluated += 1
            except Exception:
                failed += 1
                continue

        if errors:
            avg_error = sum(errors) / len(errors) if errors else 0
            gw_maes.append({
                "gameweek": gw,
                "mae": round(avg_error, 3),
                "samples": len(errors),
                "evaluated_players": evaluated,
                "skipped_players": skipped,
                "failed_players": failed,
            })

    overall_mae = round(sum(g["mae"] for g in gw_maes) / len(gw_maes), 3) if gw_maes else None
    return {"overall_mae": overall_mae, "by_gameweek": gw_maes}
