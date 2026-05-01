"""
FPL Copilot — FastAPI backend
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from data.fpl_client import get_bootstrap, get_current_gameweek
from database.repository import (
    fetch_latest_predictions,
    fetch_model_status,
    fetch_players_with_predictions,
    hydrate_prediction_context,
    load_evaluation_report,
    settings,
)
from database.session import get_session, init_db
from models.optimizer import optimize_squad
from models.predictor import predict_players

app = FastAPI(title="FPL Copilot API", version="2.0.0")
logger = logging.getLogger(__name__)
STARTUP_DB_ERROR: str | None = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root_endpoint():
    return {
        "status": "ok",
        "message": "FPL Copilot API is running.",
        "health_url": "/health",
        "players_url": "/api/players",
    }


@app.on_event("startup")
def startup() -> None:
    global STARTUP_DB_ERROR
    try:
        init_db()
        STARTUP_DB_ERROR = None
    except Exception as exc:
        STARTUP_DB_ERROR = str(exc)
        logger.warning("Starting API without live database connectivity: %s", exc)


def _load_local_prediction_snapshot() -> dict | None:
    path = settings.latest_predictions_path
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _load_local_predictions() -> list[dict]:
    snapshot = _load_local_prediction_snapshot()
    fallback_players = predict_players()
    if not snapshot:
        return fallback_players

    prediction_rows = {row["player_id"]: row for row in snapshot.get("predictions", [])}
    merged = []
    for player in fallback_players:
        row = prediction_rows.get(player["id"])
        merged.append(
            {
                **player,
                "predicted_points": row.get("predicted_points", player.get("predicted_points")) if row else player.get("predicted_points"),
                "baseline_points": row.get("baseline_points") if row else None,
                "model_version": snapshot.get("model_version"),
                "prediction_timestamp": snapshot.get("generated_at"),
                "target_gameweek": snapshot.get("target_gameweek"),
            }
        )
    merged.sort(key=lambda player: player.get("predicted_points", 0) or 0, reverse=True)
    return merged


def _fallback_model_status() -> dict:
    snapshot = _load_local_prediction_snapshot() or {}
    report = load_evaluation_report() or {}
    saved_predictions = len(snapshot.get("predictions", []))
    snapshot_timestamp = snapshot.get("generated_at") or report.get("generated_at")

    return {
        "latest_ingestion_run": {
            "status": "snapshot_only" if snapshot_timestamp else "unavailable",
            "completed_at": snapshot_timestamp,
            "rows_inserted": None,
            "error_message": STARTUP_DB_ERROR,
        },
        "latest_training_run": {
            "status": "local_report",
            "completed_at": snapshot_timestamp,
            "rows_inserted": saved_predictions or None,
        },
        "latest_prediction_timestamp": snapshot.get("generated_at"),
        "latest_prediction_gameweek": snapshot.get("target_gameweek"),
        "model_version": snapshot.get("model_version") or report.get("model_version"),
        "evaluation": report,
        "database_status": "degraded",
        "database_error": STARTUP_DB_ERROR,
    }


def _load_players() -> list[dict]:
    try:
        with get_session() as session:
            db_players = fetch_players_with_predictions(session)
            if db_players:
                return hydrate_prediction_context(session, db_players)
    except Exception as exc:
        logger.warning("Falling back to local player data: %s", exc)
    return _load_local_predictions()


def _load_predictions() -> list[dict]:
    try:
        with get_session() as session:
            db_predictions = fetch_latest_predictions(session)
            if db_predictions:
                return hydrate_prediction_context(session, db_predictions)
    except Exception as exc:
        logger.warning("Falling back to local prediction data: %s", exc)
    return _load_local_predictions()


# ---------------------------------------------------------------------------
# /api/players
# ---------------------------------------------------------------------------
@app.get("/api/players")
def players_endpoint(
    position: Optional[str] = None,
    team: Optional[str] = None,
    min_price: float = 0,
    max_price: float = 20,
    sort_by: str = "total_points",
    limit: int = Query(default=200, le=700),
):
    data = _load_players()

    if position:
        data = [p for p in data if p["position"] == position.upper()]
    if team:
        data = [p for p in data if p["team_short"].lower() == team.lower()]
    data = [p for p in data if min_price <= p["price"] <= max_price]

    valid_sort = {
        "predicted_points",
        "total_points",
        "form",
        "price",
        "selected_by_percent",
        "ict_index",
        "minutes",
    }
    key = sort_by if sort_by in valid_sort else "total_points"
    data.sort(key=lambda p: p.get(key, 0) or 0, reverse=True)

    return {"players": data[:limit], "total": len(data)}


# ---------------------------------------------------------------------------
# /api/predict
# ---------------------------------------------------------------------------
@app.get("/api/predict")
def predict_endpoint(
    position: Optional[str] = None,
    limit: int = Query(default=50, le=700),
):
    predictions = _load_predictions()
    if position:
        predictions = [p for p in predictions if p["position"] == position.upper()]
    predictions.sort(key=lambda p: p.get("predicted_points", 0) or 0, reverse=True)
    return {"predictions": predictions[:limit]}


# ---------------------------------------------------------------------------
# /api/model-status
# ---------------------------------------------------------------------------
@app.get("/api/model-status")
def model_status_endpoint():
    try:
        with get_session() as session:
            return fetch_model_status(session)
    except Exception as exc:
        logger.warning("Falling back to local model status: %s", exc)
        return _fallback_model_status()


# ---------------------------------------------------------------------------
# /api/optimize
# ---------------------------------------------------------------------------
class OptimizeRequest(BaseModel):
    budget: float = 100.0
    must_include: list[int] = []
    must_exclude: list[int] = []
    current_squad_player_ids: list[int] = []
    free_transfers: int = 0
    active_chip: str = "none"


@app.post("/api/optimize")
def optimize_endpoint(req: OptimizeRequest):
    predictions = _load_predictions()
    has_full_current_squad = len(req.current_squad_player_ids) == 15
    apply_transfer_penalty = has_full_current_squad and req.active_chip not in {
        "wildcard",
        "free_hit",
    }
    result = optimize_squad(
        players=predictions,
        budget=req.budget,
        must_include=req.must_include,
        must_exclude=req.must_exclude,
        current_squad_player_ids=req.current_squad_player_ids,
        free_transfers=req.free_transfers,
        apply_transfer_penalty=apply_transfer_penalty,
    )
    return result


# ---------------------------------------------------------------------------
# /api/differentials
# ---------------------------------------------------------------------------
@app.get("/api/differentials")
def differentials_endpoint(
    max_ownership: float = 15.0,
    min_predicted: float = 4.0,
    limit: int = 20,
):
    predictions = _load_predictions()
    diffs = [
        p
        for p in predictions
        if p["selected_by_percent"] < max_ownership
        and (p["predicted_points"] or 0) >= min_predicted
        and p["status"] == "a"
    ]
    diffs.sort(key=lambda p: p["predicted_points"], reverse=True)
    return {"differentials": diffs[:limit]}


# ---------------------------------------------------------------------------
# /api/captain
# ---------------------------------------------------------------------------
@app.get("/api/captain")
def captain_endpoint():
    predictions = _load_predictions()
    available = [p for p in predictions if p["status"] == "a" and p["minutes"] > 0]

    for p in available:
        p["captain_score"] = round((p["predicted_points"] or 0) * 2, 2)
        fdr = p.get("next_fdr", 3)
        home_str = "home" if p.get("next_home") else "away"
        p["captain_reasoning"] = (
            f"{p['name']} ({p['team_short']}) has a {home_str} fixture vs {p['next_opponent']} "
            f"(FDR {fdr:.0f}), form {p['form']}, predicted {p['predicted_points']} pts "
            f"-> {p['captain_score']} pts as captain."
        )

    available.sort(key=lambda p: p["captain_score"], reverse=True)
    return {"captain_picks": available[:5]}


# ---------------------------------------------------------------------------
# /api/squad/{team_id}
# ---------------------------------------------------------------------------
@app.get("/api/squad/{team_id}")
def squad_endpoint(team_id: int):
    import httpx

    try:
        with httpx.Client(timeout=15) as c:
            bootstrap = get_bootstrap()
            gw = get_current_gameweek(bootstrap)
            r = c.get(
                f"https://fantasy.premierleague.com/api/entry/{team_id}/event/{gw}/picks/",
                headers={"User-Agent": "FPL-Copilot/2.0"},
            )
            if r.status_code == 404:
                r = c.get(
                    f"https://fantasy.premierleague.com/api/entry/{team_id}/event/{max(gw - 1, 1)}/picks/",
                    headers={"User-Agent": "FPL-Copilot/2.0"},
                )
            r.raise_for_status()
            picks_data = r.json()

            entry_r = c.get(
                f"https://fantasy.premierleague.com/api/entry/{team_id}/",
                headers={"User-Agent": "FPL-Copilot/2.0"},
            )
            entry_r.raise_for_status()
            entry = entry_r.json()
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        if status_code == 404:
            raise HTTPException(status_code=404, detail=f"FPL team {team_id} not found")
        raise HTTPException(
            status_code=502,
            detail=f"FPL service returned {status_code} while loading team {team_id}",
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Unable to reach the FPL service right now. Please try again shortly.",
        )

    player_ids = {p["element"]: p for p in picks_data.get("picks", [])}
    predictions = _load_predictions()
    pred_map = {p["id"]: p for p in predictions}

    squad = []
    for pid, pick in player_ids.items():
        player = pred_map.get(pid, {})
        if player:
            squad.append(
                {
                    **player,
                    "multiplier": pick.get("multiplier", 1),
                    "is_captain": pick.get("is_captain", False),
                    "is_vice_captain": pick.get("is_vice_captain", False),
                    "position_in_squad": pick.get("position", 0),
                }
            )

    squad.sort(key=lambda p: p["position_in_squad"])

    return {
        "team_name": entry.get("name", f"Team {team_id}"),
        "manager": f"{entry.get('player_first_name', '')} {entry.get('player_last_name', '')}".strip(),
        "overall_rank": entry.get("summary_overall_rank"),
        "total_points": entry.get("summary_overall_points"),
        "squad": squad,
    }


# ---------------------------------------------------------------------------
# /api/backtest
# ---------------------------------------------------------------------------
@app.get("/api/backtest")
def backtest_endpoint():
    report = load_evaluation_report()
    if report:
        return report
    return {
        "message": "No evaluation report found yet. Run the training workflow first.",
        "baseline": None,
        "model": None,
    }


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    try:
        with get_session() as session:
            status = fetch_model_status(session)
        return {
            "status": "ok",
            "database_status": "connected",
            "model_version": status.get("model_version"),
            "latest_prediction_timestamp": status.get("latest_prediction_timestamp"),
            "latest_ingestion_run": status.get("latest_ingestion_run"),
        }
    except Exception:
        status = _fallback_model_status()
        return {
            "status": "degraded",
            "database_status": "unavailable",
            "database_error": STARTUP_DB_ERROR,
            "model_version": status.get("model_version"),
            "latest_prediction_timestamp": status.get("latest_prediction_timestamp"),
            "latest_ingestion_run": status.get("latest_ingestion_run"),
        }
