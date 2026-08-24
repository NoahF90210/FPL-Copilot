"""
FPL Copilot — FastAPI backend
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from threading import Lock
from time import monotonic
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


app = FastAPI(title="FPL Copilot API", version="2.0.0")
logger = logging.getLogger(__name__)
STARTUP_DB_ERROR: str | None = None
DB_RETRY_AFTER = 0.0
DB_RETRY_SECONDS = 30.0
DB_STATE_LOCK = Lock()
STALE_PREDICTION_DAYS = 7
LIVE_DATA_UNAVAILABLE_MESSAGE = (
    "Live FPL prediction data is unavailable. Resume the Supabase database and wait for the scheduled refresh."
)
PUBLIC_SERVING_METADATA_KEYS = (
    "target_gameweek",
    "generated_at",
    "serving_mode",
    "prediction_provenance",
    "model_version",
    "is_stale",
    "serving_warning",
)
cors_origins = list(settings.allowed_origins) or []

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
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


def _mark_database_available() -> None:
    global STARTUP_DB_ERROR, DB_RETRY_AFTER
    with DB_STATE_LOCK:
        STARTUP_DB_ERROR = None
        DB_RETRY_AFTER = 0.0


def _mark_database_unavailable(exc: Exception) -> None:
    global STARTUP_DB_ERROR, DB_RETRY_AFTER
    with DB_STATE_LOCK:
        STARTUP_DB_ERROR = str(exc)
        DB_RETRY_AFTER = monotonic() + DB_RETRY_SECONDS


def _should_try_database() -> bool:
    global DB_RETRY_AFTER
    with DB_STATE_LOCK:
        if STARTUP_DB_ERROR is None:
            return True
        now = monotonic()
        if now < DB_RETRY_AFTER:
            return False
        DB_RETRY_AFTER = now + DB_RETRY_SECONDS
        return True


@app.on_event("startup")
def startup() -> None:
    try:
        init_db()
        _mark_database_available()
    except Exception as exc:
        _mark_database_unavailable(exc)
        logger.warning("Starting API without live database connectivity: %s", exc)


def _unavailable_model_status() -> dict:
    metadata = _serving_metadata(
        target_gameweek=None,
        generated_at=None,
        serving_mode="unavailable",
        model_version=None,
    )
    return {
        "latest_ingestion_run": {"status": "unavailable", "completed_at": None, "rows_inserted": None},
        "latest_training_run": {"status": "unavailable", "completed_at": None, "rows_inserted": None},
        "latest_prediction_timestamp": None,
        "latest_prediction_gameweek": None,
        "model_version": None,
        "evaluation": {},
        "database_status": "unavailable",
        "prediction_serving_mode": "unavailable",
        **metadata,
    }


def _load_players_with_meta() -> tuple[list[dict], str]:
    if not _should_try_database():
        raise HTTPException(status_code=503, detail=LIVE_DATA_UNAVAILABLE_MESSAGE)
    try:
        with get_session() as session:
            db_players = fetch_players_with_predictions(session)
            if not db_players or not any(player.get("predicted_points") is not None for player in db_players):
                raise HTTPException(status_code=503, detail=LIVE_DATA_UNAVAILABLE_MESSAGE)
            hydrated = hydrate_prediction_context(session, db_players)
        _mark_database_available()
        return hydrated, "database"
    except HTTPException:
        raise
    except Exception as exc:
        _mark_database_unavailable(exc)
        logger.warning("Live player data unavailable: %s", exc)
        raise HTTPException(status_code=503, detail=LIVE_DATA_UNAVAILABLE_MESSAGE) from exc


def _load_predictions_with_meta() -> tuple[list[dict], str]:
    if not _should_try_database():
        raise HTTPException(status_code=503, detail=LIVE_DATA_UNAVAILABLE_MESSAGE)
    try:
        with get_session() as session:
            db_predictions = fetch_latest_predictions(session)
            if not db_predictions:
                raise HTTPException(status_code=503, detail=LIVE_DATA_UNAVAILABLE_MESSAGE)
            hydrated = hydrate_prediction_context(session, db_predictions)
        _mark_database_available()
        return hydrated, "database"
    except HTTPException:
        raise
    except Exception as exc:
        _mark_database_unavailable(exc)
        logger.warning("Live prediction data unavailable: %s", exc)
        raise HTTPException(status_code=503, detail=LIVE_DATA_UNAVAILABLE_MESSAGE) from exc


def _load_players() -> list[dict]:
    players, _ = _load_players_with_meta()
    return players


def _load_predictions() -> list[dict]:
    predictions, _ = _load_predictions_with_meta()
    return predictions


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _serving_metadata(
    *,
    target_gameweek: int | None,
    generated_at: str | None,
    serving_mode: str,
    model_version: str | None,
) -> dict:
    generated = _parse_timestamp(generated_at)
    age_days = (datetime.now(timezone.utc) - generated).total_seconds() / 86400 if generated else None
    is_stale = bool(age_days is not None and age_days > STALE_PREDICTION_DAYS)

    provenance = "trained_model" if serving_mode == "database" else "unavailable"
    warning = LIVE_DATA_UNAVAILABLE_MESSAGE if serving_mode == "unavailable" else None

    if is_stale:
        generated_label = generated_at or "an unknown date"
        if warning:
            warning = f"{warning} The prediction timestamp is older than {STALE_PREDICTION_DAYS} days."
        else:
            warning = f"Prediction data generated {generated_label} is older than {STALE_PREDICTION_DAYS} days."

    return {
        "target_gameweek": target_gameweek,
        "generated_at": generated_at,
        "serving_mode": serving_mode,
        "prediction_provenance": provenance,
        "model_version": model_version,
        "is_stale": is_stale,
        "serving_warning": warning,
    }


def _collection_metadata(players: list[dict], serving_mode: str) -> dict:
    gameweeks = [
        player.get("target_gameweek")
        for player in players
        if isinstance(player.get("target_gameweek"), int)
    ]
    timestamps = [
        player.get("prediction_timestamp")
        for player in players
        if isinstance(player.get("prediction_timestamp"), str) and player.get("prediction_timestamp")
    ]
    model_versions = {
        player.get("model_version")
        for player in players
        if isinstance(player.get("model_version"), str) and player.get("model_version")
    }
    return _serving_metadata(
        target_gameweek=max(gameweeks) if gameweeks else None,
        generated_at=max(timestamps) if timestamps else None,
        serving_mode=serving_mode,
        model_version=next(iter(model_versions)) if len(model_versions) == 1 else None,
    )


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
    include_next_fixtures: bool = Query(
        default=False,
        description="Include next_fixtures arrays per player (large payload). Off by default for list views.",
    ),
):
    data, serving_mode = _load_players_with_meta()
    data = [player for player in data if player.get("predicted_points") is not None]

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

    slice_players = data[:limit]
    if not include_next_fixtures:
        slice_players = [{k: v for k, v in p.items() if k != "next_fixtures"} for p in slice_players]

    return {
        "players": slice_players,
        "total": len(data),
        **_collection_metadata(data, serving_mode),
    }


# ---------------------------------------------------------------------------
# /api/predict
# ---------------------------------------------------------------------------
@app.get("/api/predict")
def predict_endpoint(
    position: Optional[str] = None,
    limit: int = Query(default=50, le=700),
):
    predictions, serving_mode = _load_predictions_with_meta()
    if position:
        predictions = [p for p in predictions if p["position"] == position.upper()]
    predictions.sort(key=lambda p: p.get("predicted_points", 0) or 0, reverse=True)
    return {
        "predictions": predictions[:limit],
        **_collection_metadata(predictions, serving_mode),
    }


# ---------------------------------------------------------------------------
# /api/model-status
# ---------------------------------------------------------------------------
@app.get("/api/model-status")
def model_status_endpoint():
    if _should_try_database():
        try:
            with get_session() as session:
                status = fetch_model_status(session)
            _mark_database_available()
            metadata = _serving_metadata(
                target_gameweek=status.get("latest_prediction_gameweek"),
                generated_at=status.get("latest_prediction_timestamp"),
                serving_mode=status.get("prediction_serving_mode") or "unavailable",
                model_version=status.get("model_version"),
            )
            return {**status, **metadata}
        except Exception as exc:
            _mark_database_unavailable(exc)
            logger.warning("Live model status unavailable: %s", exc)
    return _unavailable_model_status()


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
    predictions, serving_mode = _load_predictions_with_meta()
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
    return {
        **result,
        **_collection_metadata(predictions, serving_mode),
    }


# ---------------------------------------------------------------------------
# /api/differentials
# ---------------------------------------------------------------------------
@app.get("/api/differentials")
def differentials_endpoint(
    max_ownership: float = 15.0,
    min_predicted: float = 4.0,
    limit: int = 20,
):
    predictions, serving_mode = _load_predictions_with_meta()
    diffs = [
        p
        for p in predictions
        if p["selected_by_percent"] < max_ownership
        and (p["predicted_points"] or 0) >= min_predicted
        and p["status"] == "a"
    ]
    diffs.sort(key=lambda p: p["predicted_points"], reverse=True)
    return {
        "differentials": diffs[:limit],
        **_collection_metadata(predictions, serving_mode),
    }


# ---------------------------------------------------------------------------
# /api/captain
# ---------------------------------------------------------------------------
@app.get("/api/captain")
def captain_endpoint():
    predictions, serving_mode = _load_predictions_with_meta()
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
    return {
        "captain_picks": available[:5],
        **_collection_metadata(predictions, serving_mode),
    }


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
    serving_status = model_status_endpoint()
    database_status = serving_status.get("database_status")
    predictions_current = (
        database_status == "connected"
        and serving_status.get("prediction_serving_mode") == "database"
        and not serving_status.get("is_stale", False)
    )
    return {
        "status": "ok" if predictions_current else "degraded",
        "database_status": database_status,
        "prediction_serving_mode": serving_status.get("serving_mode"),
        "latest_prediction_timestamp": serving_status.get("generated_at"),
        "latest_prediction_gameweek": serving_status.get("target_gameweek"),
        "latest_ingestion_run": serving_status.get("latest_ingestion_run"),
        **{key: serving_status.get(key) for key in PUBLIC_SERVING_METADATA_KEYS},
    }
