from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import joblib
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import get_settings
from database.models import Fixture, ModelPrediction, Player, PlayerGameweekStat
from database.repository import save_json_report, save_pipeline_run

try:
    import mlflow
    import mlflow.sklearn
except ImportError:  # pragma: no cover - optional dependency in constrained environments
    mlflow = None


settings = get_settings()
logger = logging.getLogger(__name__)
MODEL_VERSION = "ridge_recent_form_v1"
BASELINE_VERSION = "recent_points_average_v1"
BASELINE_FEATURE = "rolling_points_5"
FEATURE_COLUMNS = [
    "rolling_points_5",
    "rolling_minutes_5",
    "opponent_fdr",
]


def _build_training_dataframe(session: Session) -> pd.DataFrame:
    stmt = (
        select(
            PlayerGameweekStat.player_id,
            PlayerGameweekStat.team_id,
            PlayerGameweekStat.gameweek,
            PlayerGameweekStat.minutes,
            PlayerGameweekStat.total_points,
            PlayerGameweekStat.opponent_fdr,
        )
        .order_by(PlayerGameweekStat.player_id.asc(), PlayerGameweekStat.gameweek.asc())
    )
    rows = session.execute(stmt).all()
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(
        rows,
        columns=[
            "player_id",
            "team_id",
            "gameweek",
            "minutes",
            "total_points",
            "opponent_fdr",
        ],
    )

    grouped = df.groupby("player_id", group_keys=False)
    df["games_played"] = grouped.cumcount()
    df["rolling_points_5"] = grouped["total_points"].transform(
        lambda values: values.shift(1).rolling(window=5, min_periods=1).mean()
    )
    df["rolling_minutes_5"] = grouped["minutes"].transform(
        lambda values: values.shift(1).rolling(window=5, min_periods=1).mean()
    )

    df = df[df["games_played"] >= 3].copy()
    return df


def _build_next_gameweek_dataframe(session: Session) -> tuple[pd.DataFrame, int]:
    players = pd.DataFrame(
        session.execute(select(Player.id, Player.team_id, Player.status)).all(),
        columns=["player_id", "team_id", "status"],
    )
    if players.empty:
        return players, 1

    hist = pd.DataFrame(
        session.execute(
            select(
                PlayerGameweekStat.player_id,
                PlayerGameweekStat.gameweek,
                PlayerGameweekStat.total_points,
                PlayerGameweekStat.minutes,
            )
        ).all(),
        columns=["player_id", "gameweek", "total_points", "minutes_hist"],
    )

    latest_gw = int(hist["gameweek"].max()) if not hist.empty else 0

    if hist.empty:
        players["games_played"] = 0
        players["rolling_points_5"] = 0.0
        players["rolling_minutes_5"] = 0.0
    else:
        grouped = hist.sort_values(["player_id", "gameweek"]).groupby("player_id")
        features = grouped.agg(
            games_played=("gameweek", "count"),
            rolling_points_5=("total_points", lambda values: values.tail(5).mean()),
            rolling_minutes_5=("minutes_hist", lambda values: values.tail(5).mean()),
        ).reset_index()
        players = players.merge(features, how="left", on="player_id")

    upcoming = pd.DataFrame(
        session.execute(
            select(
                Fixture.gameweek,
                Fixture.team_h,
                Fixture.team_a,
                Fixture.team_h_difficulty,
                Fixture.team_a_difficulty,
            )
            .where(Fixture.finished.is_(False))
            .order_by(Fixture.gameweek.asc(), Fixture.id.asc())
        ).all(),
        columns=["gameweek", "team_h", "team_a", "team_h_difficulty", "team_a_difficulty"],
    )
    next_gameweek = int(upcoming["gameweek"].min()) if not upcoming.empty else latest_gw + 1
    next_fixture_rows = []
    for team_id in players["team_id"].unique():
        team_fixtures = upcoming[(upcoming["team_h"] == team_id) | (upcoming["team_a"] == team_id)]
        team_fixtures = team_fixtures[team_fixtures["gameweek"] >= next_gameweek]
        if team_fixtures.empty:
            next_fixture_rows.append({"team_id": team_id, "opponent_fdr": 3.0})
            continue
        next_fixture = team_fixtures.iloc[0]
        is_home = int(next_fixture["team_h"] == team_id)
        next_fixture_rows.append(
            {
                "team_id": team_id,
                "opponent_fdr": float(
                    next_fixture["team_h_difficulty"] if is_home else next_fixture["team_a_difficulty"]
                ),
            }
        )

    players = players.merge(pd.DataFrame(next_fixture_rows), how="left", on="team_id")
    players.fillna(
        {
            "games_played": 0,
            "rolling_points_5": 0.0,
            "rolling_minutes_5": 0.0,
            "opponent_fdr": 3.0,
        },
        inplace=True,
    )
    return players, next_gameweek


def _build_preprocessor() -> Pipeline:
    return Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )


def _write_markdown_report(report: dict[str, Any]) -> None:
    markdown = f"""# Latest Model Evaluation

- Generated at: {report["generated_at"]}
- Model version: {report["model_version"]}
- Baseline version: {report["baseline_version"]}
- Features: {", ".join(report["feature_columns"])}
- Validation: {report["validation_strategy"]} over gameweeks {report["validation_gameweeks"]}
- Primary metric: MAE

| Approach | MAE | RMSE (secondary) |
|---|---:|---:|
| Recent five-appearance points average | {report["baseline"]["mae"]:.3f} | {report["baseline"]["rmse"]:.3f} |
| Ridge regression | {report["model"]["mae"]:.3f} | {report["model"]["rmse"]:.3f} |
"""
    report_path = settings.reports_dir / "latest_evaluation.md"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(markdown)


def _log_training_run_to_mlflow(
    *,
    report: dict[str, Any],
    target_gameweek: int,
    saved_predictions: list[dict[str, Any]],
    model_pipeline: Pipeline,
) -> None:
    if mlflow is None:
        logger.warning("MLflow is not installed, so experiment tracking will be skipped.")
        return

    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment(settings.mlflow_experiment_name)

    run_name = f"gw-{target_gameweek}-training-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
    with mlflow.start_run(run_name=run_name):
        mlflow.set_tags(
            {
                "app": "fpl-copilot",
                "app_env": settings.app_env,
                "model_version": MODEL_VERSION,
                "baseline_version": BASELINE_VERSION,
            }
        )
        mlflow.log_params(
            {
                "feature_count": len(FEATURE_COLUMNS),
                "validation_start_gameweek": min(report["validation_gameweeks"]),
                "validation_end_gameweek": max(report["validation_gameweeks"]),
                "training_rows": report["training_rows"],
                "validation_rows": report["validation_rows"],
                "target_gameweek": target_gameweek,
                "saved_predictions": len(saved_predictions),
                "baseline_type": "recent_points_average",
                "baseline_feature": BASELINE_FEATURE,
                "main_model_type": "Ridge",
                "main_alpha": 1.0,
                "primary_metric": report["primary_metric"],
            }
        )
        mlflow.log_metrics(
            {
                "baseline_mae": report["baseline"]["mae"],
                "baseline_rmse": report["baseline"]["rmse"],
                "model_mae": report["model"]["mae"],
                "model_rmse": report["model"]["rmse"],
            }
        )

        mlflow.sklearn.log_model(model_pipeline, name="main")
        mlflow.log_artifact(str(settings.model_artifact_path), artifact_path="artifacts")
        mlflow.log_artifact(str(settings.evaluation_report_path), artifact_path="reports")
        markdown_report_path = settings.reports_dir / "latest_evaluation.md"
        if markdown_report_path.exists():
            mlflow.log_artifact(str(markdown_report_path), artifact_path="reports")
        if settings.latest_predictions_path.exists():
            mlflow.log_artifact(str(settings.latest_predictions_path), artifact_path="reports")


def train_and_score(session: Session) -> dict[str, Any]:
    started_at = datetime.utcnow()
    training_df = _build_training_dataframe(session)
    if training_df.empty:
        raise RuntimeError("Not enough historical data in the warehouse. Run ingestion first.")

    max_gameweek = int(training_df["gameweek"].max())
    validation_start = max(max_gameweek - 4, int(training_df["gameweek"].min()))
    train_df = training_df[training_df["gameweek"] < validation_start].copy()
    valid_df = training_df[training_df["gameweek"] >= validation_start].copy()

    if train_df.empty or valid_df.empty:
        raise RuntimeError("Not enough training data to create a time-based validation split.")

    X_train = train_df[FEATURE_COLUMNS]
    y_train = train_df["total_points"]
    X_valid = valid_df[FEATURE_COLUMNS]
    y_valid = valid_df["total_points"]

    model_pipeline = Pipeline(
        steps=[
            ("preprocessor", _build_preprocessor()),
            ("model", Ridge(alpha=1.0)),
        ]
    )

    model_pipeline.fit(X_train, y_train)

    baseline_preds = valid_df[BASELINE_FEATURE].fillna(0.0).clip(lower=0.0).to_numpy()
    model_preds = model_pipeline.predict(X_valid).clip(min=0.0)
    baseline_rmse = mean_squared_error(y_valid, baseline_preds) ** 0.5
    model_rmse = mean_squared_error(y_valid, model_preds) ** 0.5

    report = {
        "generated_at": datetime.utcnow().isoformat(),
        "model_version": MODEL_VERSION,
        "baseline_version": BASELINE_VERSION,
        "feature_columns": FEATURE_COLUMNS,
        "primary_metric": "mae",
        "validation_strategy": "later_gameweek_holdout",
        "validation_gameweeks": sorted(valid_df["gameweek"].unique().tolist()),
        "baseline": {
            "mae": float(mean_absolute_error(y_valid, baseline_preds)),
            "rmse": float(baseline_rmse),
        },
        "model": {
            "mae": float(mean_absolute_error(y_valid, model_preds)),
            "rmse": float(model_rmse),
        },
        "training_rows": int(len(train_df)),
        "validation_rows": int(len(valid_df)),
    }

    settings.model_artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "model": model_pipeline,
            "baseline": {
                "type": "recent_points_average",
                "feature": BASELINE_FEATURE,
                "version": BASELINE_VERSION,
            },
            "feature_columns": FEATURE_COLUMNS,
            "model_version": MODEL_VERSION,
            "trained_at": datetime.utcnow().isoformat(),
        },
        settings.model_artifact_path,
    )
    save_json_report(settings.evaluation_report_path, report)
    _write_markdown_report(report)

    current_df, target_gameweek = _build_next_gameweek_dataframe(session)
    if current_df.empty:
        raise RuntimeError("No player records available for prediction scoring.")

    scored_rows = current_df[current_df["status"] != "u"].copy()
    scored_rows["predicted_points"] = model_pipeline.predict(scored_rows[FEATURE_COLUMNS]).clip(min=0)
    scored_rows["baseline_points"] = (
        scored_rows[BASELINE_FEATURE].fillna(0.0).clip(lower=0.0)
    )
    residuals = y_valid - model_preds
    confidence = max(float(residuals.std()), 0.5)
    prediction_timestamp = datetime.utcnow()

    session.query(ModelPrediction).filter(ModelPrediction.target_gameweek == target_gameweek).delete()

    saved_predictions = []
    for row in scored_rows.itertuples():
        prediction = ModelPrediction(
            player_id=int(row.player_id),
            target_gameweek=target_gameweek,
            model_version=MODEL_VERSION,
            prediction_timestamp=prediction_timestamp,
            predicted_points=round(float(row.predicted_points), 3),
            baseline_points=round(float(row.baseline_points), 3),
            confidence=confidence,
            metadata_json={
                "games_played": int(row.games_played),
                "rolling_points_5": float(row.rolling_points_5),
                "rolling_minutes_5": float(row.rolling_minutes_5),
                "opponent_fdr": float(row.opponent_fdr),
            },
        )
        session.add(prediction)
        saved_predictions.append(
            {
                "player_id": int(row.player_id),
                "predicted_points": round(float(row.predicted_points), 3),
                "baseline_points": round(float(row.baseline_points), 3),
            }
        )

    save_json_report(
        settings.latest_predictions_path,
        {
            "generated_at": prediction_timestamp.isoformat(),
            "target_gameweek": target_gameweek,
            "model_version": MODEL_VERSION,
            "predictions": saved_predictions,
        },
    )
    _log_training_run_to_mlflow(
        report=report,
        target_gameweek=target_gameweek,
        saved_predictions=saved_predictions,
        model_pipeline=model_pipeline,
    )

    save_pipeline_run(
        session,
        run_type="training",
        status="success",
        source_endpoints=None,
        rows_inserted=len(saved_predictions),
        rows_updated=0,
        metadata_json=report,
        started_at=started_at,
        completed_at=datetime.utcnow(),
    )
    session.commit()
    return {
        "target_gameweek": target_gameweek,
        "model_version": MODEL_VERSION,
        "saved_predictions": len(saved_predictions),
        "report": report,
    }
