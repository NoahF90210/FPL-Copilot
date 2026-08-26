from datetime import datetime, timezone
from pathlib import Path

import main
import pytest
from fastapi.testclient import TestClient
from database.models import PipelineRun
from database.repository import serialize_pipeline_summary


ROOT = Path(__file__).resolve().parents[2]
def test_prediction_metadata_accepts_non_gw37_payloads(monkeypatch):
    players = [
        {
            "id": 1,
            "name": "Example",
            "position": "MID",
            "predicted_points": 5.5,
            "target_gameweek": 38,
            "prediction_timestamp": datetime.now(timezone.utc).isoformat(),
        }
    ]
    monkeypatch.setattr(main, "_load_predictions_with_meta", lambda: (players, "database"))

    response = main.predict_endpoint(limit=50)

    assert response["predictions"] == players
    assert response["target_gameweek"] == 38
    assert response["generated_at"] == players[0]["prediction_timestamp"]
    assert response["serving_mode"] == "database"
    assert response["prediction_provenance"] == "trained_model"
    assert response["is_stale"] is False


def test_database_unavailable_http_routes_do_not_serve_demo_data(monkeypatch):
    def unavailable_database():
        raise ConnectionError("database unavailable for regression test")

    monkeypatch.setattr(main, "init_db", unavailable_database)
    monkeypatch.setattr(main, "STARTUP_DB_ERROR", None)
    monkeypatch.setattr(main, "DB_RETRY_AFTER", 0.0)

    with TestClient(main.app) as client:
        for path in [
            "/api/players?limit=700&sort_by=predicted_points",
            "/api/predict?limit=700",
            "/api/differentials",
            "/api/captain",
        ]:
            response = client.get(path)
            assert response.status_code == 503
            assert "Live FPL prediction data is unavailable" in response.json()["detail"]

        status = client.get("/api/model-status").json()
        health = client.get("/health").json()

    assert status["prediction_serving_mode"] == "unavailable"
    assert status["database_status"] == "unavailable"
    assert "database_error" not in status
    assert health["status"] == "degraded"
    assert "database_error" not in health


def test_recent_database_failure_returns_unavailable_without_retrying(monkeypatch):
    def unexpected_session():
        raise AssertionError("database should not be retried during the cooldown")

    monkeypatch.setattr(main, "STARTUP_DB_ERROR", "connection failed")
    monkeypatch.setattr(main, "DB_RETRY_AFTER", float("inf"))
    monkeypatch.setattr(main, "get_session", unexpected_session)

    with pytest.raises(main.HTTPException) as error:
        main._load_predictions_with_meta()

    assert error.value.status_code == 503


def test_unavailable_status_does_not_expose_database_errors(monkeypatch):
    monkeypatch.setattr(main, "STARTUP_DB_ERROR", "postgresql://user:secret@example.invalid")

    response = main._unavailable_model_status()

    assert "database_error" not in response
    assert "error_message" not in (response.get("latest_ingestion_run") or {})
    assert response["prediction_serving_mode"] == "unavailable"


def test_public_pipeline_summary_omits_internal_run_details():
    run = PipelineRun(
        run_type="training",
        status="failed",
        source_endpoints=["https://example.invalid/private"],
        metadata_json={"debug": "internal"},
        error_message="credential-bearing exception",
        rows_inserted=12,
        rows_updated=3,
        started_at=datetime(2026, 8, 17, 8, 0, 0),
        completed_at=datetime(2026, 8, 17, 8, 1, 0),
    )

    summary = serialize_pipeline_summary(run)

    assert summary == {
        "id": None,
        "run_type": "training",
        "status": "failed",
        "source_endpoints": ["https://example.invalid/private"],
        "rows_inserted": 12,
        "rows_updated": 3,
        "metadata_json": None,
        "error_message": None,
        "started_at": "2026-08-17T08:00:00",
        "completed_at": "2026-08-17T08:01:00",
    }


def test_frontend_has_no_fixed_dashboard_gameweek_or_css_hide():
    dashboard_source = (ROOT / "frontend/app/page.tsx").read_text()
    global_css = (ROOT / "frontend/app/globals.css").read_text()

    assert "DASHBOARD_GAMEWEEK" not in dashboard_source
    assert "target_gameweek === 37" not in dashboard_source
    assert "nth-child(4)" not in global_css


def test_frontend_does_not_embed_demo_prediction_content():
    dashboard_source = (ROOT / "frontend/app/page.tsx").read_text()
    assert "dashboard-demo-data" not in dashboard_source
    assert "Method and provenance" not in dashboard_source

    for relative_path in [
        "frontend/app/players/page.tsx",
        "frontend/app/squad/page.tsx",
        "frontend/app/optimize/page.tsx",
    ]:
        source = (ROOT / relative_path).read_text()
        assert "savedPredictionPlayers" not in source
        assert "SAVED_PREDICTION_METADATA" not in source
        assert "EMPTY_PREDICTION_METADATA" in source

    api_source = (ROOT / "frontend/lib/api.ts").read_text()
    assert "DEFAULT_REQUEST_TIMEOUT_MS" in api_source
    assert "AbortController" in api_source
