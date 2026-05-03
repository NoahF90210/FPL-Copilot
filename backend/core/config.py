from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    database_url: str
    reports_dir: Path
    model_artifact_path: Path
    evaluation_report_path: Path
    latest_predictions_path: Path
    mlflow_tracking_uri: str
    mlflow_experiment_name: str
    allowed_origins: tuple[str, ...]
    app_env: str = "development"


def resolve_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT_DIR.parent / path


def resolve_tracking_uri(value: str | Path) -> str:
    string_value = str(value)
    if "://" in string_value:
        return string_value
    return resolve_path(string_value).as_uri()


def parse_origins(value: str | None, *, app_env: str) -> tuple[str, ...]:
    if value:
        origins = tuple(origin.strip() for origin in value.split(",") if origin.strip())
        if origins:
            return origins
    if app_env == "production":
        return tuple()
    return ("*",)


def get_settings() -> Settings:
    app_env = os.getenv("APP_ENV", "development")
    reports_dir = resolve_path(os.getenv("REPORTS_DIR", ROOT_DIR / "reports"))
    model_artifact_path = resolve_path(
        os.getenv("MODEL_ARTIFACT_PATH", reports_dir / "artifacts" / "latest_model.joblib")
    )
    evaluation_report_path = resolve_path(
        os.getenv("EVALUATION_REPORT_PATH", reports_dir / "latest_evaluation.json")
    )
    latest_predictions_path = resolve_path(
        os.getenv("LATEST_PREDICTIONS_PATH", reports_dir / "latest_predictions.json")
    )
    mlflow_tracking_uri = resolve_tracking_uri(
        os.getenv("MLFLOW_TRACKING_URI", ROOT_DIR / "mlruns")
    )

    return Settings(
        database_url=os.getenv("DATABASE_URL", f"sqlite:///{ROOT_DIR / 'fpl_copilot.db'}"),
        reports_dir=reports_dir,
        model_artifact_path=model_artifact_path,
        evaluation_report_path=evaluation_report_path,
        latest_predictions_path=latest_predictions_path,
        mlflow_tracking_uri=mlflow_tracking_uri,
        mlflow_experiment_name=os.getenv("MLFLOW_EXPERIMENT_NAME", "fpl-copilot"),
        allowed_origins=parse_origins(os.getenv("ALLOWED_ORIGINS"), app_env=app_env),
        app_env=app_env,
    )
