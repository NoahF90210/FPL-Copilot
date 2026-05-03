from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Select, desc, func, select
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
        started_at=started_at or datetime.utcnow(),
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


def _latest_prediction_subquery():
    latest_ts = (
        select(
            ModelPrediction.player_id,
            func.max(ModelPrediction.prediction_timestamp).label("latest_prediction_timestamp"),
        )
        .group_by(ModelPrediction.player_id)
        .subquery()
    )
    return latest_ts


def fetch_players_with_predictions(session: Session) -> list[dict[str, Any]]:
    latest_ts = _latest_prediction_subquery()
    stmt = (
        select(Player, Team, ModelPrediction)
        .join(Team, Team.id == Player.team_id)
        .outerjoin(latest_ts, latest_ts.c.player_id == Player.id)
        .outerjoin(
            ModelPrediction,
            (ModelPrediction.player_id == Player.id)
            & (ModelPrediction.prediction_timestamp == latest_ts.c.latest_prediction_timestamp),
        )
    )

    players: list[dict[str, Any]] = []
    for player, team, prediction in session.execute(stmt).all():
        players.append(
            {
                "id": player.id,
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


def fetch_upcoming_fixtures(session: Session) -> dict[int, list[dict[str, Any]]]:
    stmt = select(Fixture).where(Fixture.finished.is_(False)).order_by(Fixture.gameweek.asc(), Fixture.id.asc())
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
    team_fixtures = fetch_upcoming_fixtures(session)
    hydrated = []

    for player in players:
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
    latest_prediction = latest_prediction_metadata(session)
    report = load_evaluation_report() or {}
    snapshot = load_prediction_snapshot() or {}

    latest_prediction_timestamp = (
        latest_prediction.prediction_timestamp.isoformat()
        if latest_prediction and latest_prediction.prediction_timestamp
        else snapshot.get("generated_at")
    )
    latest_prediction_gameweek = (
        latest_prediction.target_gameweek
        if latest_prediction and latest_prediction.target_gameweek is not None
        else snapshot.get("target_gameweek")
    )
    model_version = (
        latest_prediction.model_version
        if latest_prediction and latest_prediction.model_version
        else snapshot.get("model_version") or report.get("model_version")
    )

    return {
        "latest_ingestion_run": serialize_pipeline_run(latest_ingestion),
        "latest_training_run": serialize_pipeline_run(latest_training),
        "latest_prediction_timestamp": latest_prediction_timestamp,
        "latest_prediction_gameweek": latest_prediction_gameweek,
        "model_version": model_version,
        "evaluation": report,
        "database_status": "connected",
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
