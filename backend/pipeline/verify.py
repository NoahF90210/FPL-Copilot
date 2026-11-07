"""Read-only acceptance checks shared with the public serving boundary."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from data.fpl_client import get_prediction_gameweek
from database.repository import (
    latest_pipeline_run, official_snapshot_matches, utc_timestamp,
    verified_prediction_batch, verified_roster, verified_schedule,
)


def verify_refresh(
    session: Session, bootstrap: dict, fixtures: list[dict], *, now: datetime | None = None,
    max_age_hours: float = 36,
) -> dict:
    now = utc_timestamp(now or datetime.now(timezone.utc))
    ingestion, roster = verified_roster(session)
    if ingestion is None:
        raise RuntimeError("No complete verified roster snapshot.")
    if (not verified_schedule(session, ingestion)
            or not official_snapshot_matches(ingestion, roster, bootstrap, fixtures)):
        raise RuntimeError("Stored roster or fixture schedule does not match the official snapshot.")
    training = latest_pipeline_run(session, "training")
    latest_ingestion = latest_pipeline_run(session, "ingestion")
    for run in (latest_ingestion, training):
        if run is None or run.status != "success" or run.completed_at is None:
            raise RuntimeError("Latest ingestion and training must both have completed successfully.")
        age = now - utc_timestamp(run.completed_at)
        if age < -timedelta(minutes=5) or age > timedelta(hours=max_age_hours):
            raise RuntimeError("Refresh run timestamp is expired or in the future.")
    assert training is not None
    batch = verified_prediction_batch(session, bootstrap=bootstrap, fixtures=fixtures,
                                      now=now, max_age_hours=max_age_hours)
    if not batch:
        raise RuntimeError("Forecast batch failed identity, coverage, target, or freshness verification.")
    return {
        "status": "verified", "season": ingestion.metadata_json["season"],
        "target_gameweek": get_prediction_gameweek(bootstrap),
        "roster_players": len(roster), "predictions": len(batch),
        "prediction_timestamp": next(iter(batch.values())).prediction_timestamp.isoformat(),
        "ingestion_run_id": ingestion.id, "training_run_id": training.id,
        "history_policy": "verified_current_season_only",
    }
