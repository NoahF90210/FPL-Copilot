from core.config import get_settings


def test_mlflow_settings_defaults_are_populated(monkeypatch):
    monkeypatch.delenv("MLFLOW_TRACKING_URI", raising=False)
    monkeypatch.delenv("MLFLOW_EXPERIMENT_NAME", raising=False)
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.setenv("APP_ENV", "development")

    settings = get_settings()

    assert settings.mlflow_experiment_name == "fpl-copilot"
    assert settings.mlflow_tracking_uri.startswith("file://")
    assert settings.mlflow_tracking_uri.endswith("/backend/mlruns")
    assert settings.allowed_origins == ("*",)


def test_production_origins_require_explicit_value(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)

    settings = get_settings()

    assert settings.allowed_origins == tuple()


def test_explicit_allowed_origins_are_split(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv(
        "ALLOWED_ORIGINS",
        "https://fpl-copilot.example.com, https://www.fpl-copilot.example.com",
    )

    settings = get_settings()

    assert settings.allowed_origins == (
        "https://fpl-copilot.example.com",
        "https://www.fpl-copilot.example.com",
    )
