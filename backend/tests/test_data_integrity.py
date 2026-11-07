from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import Session

from database.models import Base, Fixture, ModelPrediction, PipelineRun, Player, PlayerGameweekStat, Team
from database.repository import fetch_latest_predictions
from pipeline import ingest, modeling
from pipeline.modeling import _build_training_dataframe
from pipeline.verify import verify_refresh
from factories import SEASON, ingest_official_data, official_data


def make_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return Session(engine)


def add_unverified_player(session):
    session.add(Team(id=1, name="Example FC", short_name="EX"))
    player = Player(
        id=606, first_name="Triston", second_name="Rowe", web_name="Rowe",
        full_name="Triston Rowe", team_id=1, position="DEF", position_id=2,
        price=4.0, status="a",
    )
    session.add(player)
    return player


def test_unverified_legacy_history_cannot_supply_training_features():
    with make_session() as session:
        add_unverified_player(session)
        for gameweek in range(1, 5):
            session.add(PlayerGameweekStat(
                player_id=606, team_id=1, season="legacy", gameweek=gameweek,
                minutes=90, total_points=10, opponent_fdr=2,
            ))
        session.commit()
        assert _build_training_dataframe(session).empty


def test_unverified_prediction_is_not_served_as_current_player_advice():
    with make_session() as session:
        add_unverified_player(session)
        session.add(ModelPrediction(
            player_id=606, target_gameweek=9, model_version="ridge_recent_form_v1",
            prediction_timestamp=datetime.now(timezone.utc), predicted_points=4.23,
            baseline_points=6.6,
        ))
        session.commit()
        assert fetch_latest_predictions(session) == []

@pytest.fixture
def warehouse(monkeypatch, tmp_path):
    bootstrap, fixtures, summaries = official_data()
    with make_session() as session:
        ingest_official_data(monkeypatch, session, (bootstrap, fixtures, summaries))
        monkeypatch.setattr(modeling, "get_bootstrap", lambda: bootstrap)
        monkeypatch.setattr(modeling, "settings", SimpleNamespace(
            reports_dir=tmp_path, model_artifact_path=tmp_path / "model.joblib",
            evaluation_report_path=tmp_path / "evaluation.json",
            latest_predictions_path=tmp_path / "predictions.json",
        ))
        monkeypatch.setattr(modeling, "_log_training_run_to_mlflow", lambda **kwargs: None)
        modeling.train_and_score(session)
        yield session, bootstrap


def test_complete_ingestion_training_verification_and_serving(warehouse):
    session, bootstrap = warehouse
    result = verify_refresh(session, bootstrap, official_data()[1])
    assert result["target_gameweek"] == 11
    assert result["roster_players"] == 2
    assert result["predictions"] == 2
    predictions = fetch_latest_predictions(session)
    rowe = next(p for p in predictions if p["id"] == 606)
    assert rowe["full_name"] == "Triston Rowe"
    assert rowe["baseline_points"] == 0
    assert rowe["player_code"] == 569577
    assert rowe["season"] == SEASON


def test_history_excludes_wrong_person_legacy_seasons_and_unfinished_fixtures(warehouse):
    session, _ = warehouse
    session.add(Fixture(id=50, season=SEASON, is_current=True, gameweek=9, team_h=1, team_a=2, finished=True))
    session.add_all([
        PlayerGameweekStat(player_id=606, player_code=123, team_id=1,
                           fixture_id=50, season=SEASON, gameweek=9, minutes=90, total_points=99),
        PlayerGameweekStat(player_id=606, player_code=569577, team_id=1,
                           fixture_id=50, season="legacy", gameweek=35, minutes=90, total_points=99),
    ])
    # An unfinished fixture can contain provisional values; it is not training history.
    unfinished = session.query(PlayerGameweekStat).filter_by(player_id=606, fixture_id=10).one()
    unfinished.total_points = 99
    session.commit()
    frame, _ = modeling._build_next_gameweek_dataframe(session)
    rowe = frame[frame.player_id == 606].iloc[0]
    assert rowe["games_played"] == 9
    assert rowe["rolling_points_5"] == 0
    assert rowe["rolling_minutes_5"] == 0
    training = _build_training_dataframe(session)
    assert set(training.season) == {SEASON}
    assert training[training.player_id == 606].total_points.sum() == 0


def test_reassigned_id_retires_old_registrations_and_clears_forecasts(monkeypatch):
    with make_session() as session:
        old = add_unverified_player(session)
        old.fpl_code, old.season, old.is_current = 111, "2025/26", True
        session.add(Player(id=900, fpl_code=900, season="2025/26", is_current=True,
                           first_name="Departed", second_name="Player", full_name="Departed Player",
                           web_name="Departed", team_id=1, position="DEF", position_id=2, price=4))
        session.add(PlayerGameweekStat(player_id=606, player_code=111, team_id=1,
                                      season="2025/26", gameweek=35, minutes=90, total_points=99))
        session.add(ModelPrediction(player_id=606, target_gameweek=9, model_version="old",
                                    prediction_timestamp=datetime.now(timezone.utc), predicted_points=99))
        session.commit()
        ingest_official_data(monkeypatch, session)
        session.expire_all()
        assert session.get(Player, 606).fpl_code == 569577
        assert session.get(Player, 900).is_current is False
        assert session.query(ModelPrediction).count() == 0
        assert session.query(PlayerGameweekStat).filter_by(season="2025/26").count() == 1
        # Retrying the same snapshot updates records, without duplicating history.
        ingest_official_data(monkeypatch, session)
        assert session.query(PlayerGameweekStat).count() == 21


def test_failed_ingestion_rolls_back_context_and_preserves_previous_batch(warehouse, monkeypatch):
    session, bootstrap = warehouse
    data = official_data()
    data[0]["elements"][0]["first_name"] = "Changed"
    del data[2][449]["history"]
    with pytest.raises(ValueError, match="Missing official history"):
        ingest_official_data(monkeypatch, session, data)
    session.expire_all()
    assert session.get(Player, 606).first_name == "Triston"
    assert session.query(ModelPrediction).count() == 2
    # Rolled-back records survive, but a changed official identity must not be served.
    assert fetch_latest_predictions(session) == []
    # A failed refresh must not pass verification.
    with pytest.raises(RuntimeError, match="completed successfully"):
        verify_refresh(session, bootstrap, official_data()[1])


@pytest.mark.parametrize("fault", [
    "expired", "future", "wrong_target", "missing_player", "mixed_timestamps",
    "wrong_person", "wrong_context", "wrong_ingestion", "nonfinite", "wrong_count", "wrong_display_name",
])
def test_verification_rejects_invalid_forecast_batches(warehouse, fault):
    session, bootstrap = warehouse
    rows = session.query(ModelPrediction).all()
    if fault == "expired":
        for row in rows:
            row.prediction_timestamp = datetime.now(timezone.utc) - timedelta(days=2)
    elif fault == "future":
        for row in rows:
            row.prediction_timestamp = datetime.now(timezone.utc) + timedelta(days=1)
    elif fault == "wrong_target":
        for row in rows:
            row.target_gameweek = 9
    elif fault == "missing_player":
        session.delete(rows[0])
    elif fault == "mixed_timestamps":
        rows[0].prediction_timestamp -= timedelta(minutes=1)
    elif fault == "wrong_person":
        rows[0].metadata_json = {**rows[0].metadata_json, "player_code": 123}
    elif fault == "wrong_context":
        session.get(Player, 606).team_id = 2
    elif fault == "wrong_ingestion":
        rows[0].metadata_json = {**rows[0].metadata_json, "ingestion_run_id": -1}
    elif fault == "nonfinite":
        rows[0].predicted_points = float("inf")
    elif fault == "wrong_display_name":
        session.get(Player, 606).web_name = "Smith Rowe"
    elif fault == "wrong_count":
        session.query(PipelineRun).filter_by(run_type="training").one().rows_inserted = 99
    session.commit()
    assert fetch_latest_predictions(session) == []
    with pytest.raises(RuntimeError):
        verify_refresh(session, bootstrap, official_data()[1])


def test_blank_target_week_does_not_borrow_a_later_fixture(warehouse, monkeypatch):
    session, _ = warehouse
    data = official_data()
    data[1][-1]["event"] = 12
    ingest_official_data(monkeypatch, session, data)
    frame, target = modeling._build_next_gameweek_dataframe(session)
    assert target == 11
    assert set(frame.target_fixture_count) == {0}
    modeling.train_and_score(session)
    assert all(p["predicted_points"] == 0 for p in fetch_latest_predictions(session))
    assert verify_refresh(session, data[0], data[1])["status"] == "verified"


def test_changed_stored_fixture_is_not_treated_as_a_real_blank_week(warehouse):
    session, bootstrap = warehouse
    session.get(Fixture, 11).gameweek = 12
    session.commit()
    assert fetch_latest_predictions(session) == []
    with pytest.raises(RuntimeError, match="fixture schedule"):
        verify_refresh(session, bootstrap, official_data()[1])


def test_removed_official_history_is_retired_not_reused(warehouse, monkeypatch):
    session, _ = warehouse
    data = official_data()
    data[2][449]["history"] = [h for h in data[2][449]["history"] if h["round"] != 9]
    ingest_official_data(monkeypatch, session, data)
    removed = session.query(PlayerGameweekStat).filter_by(player_id=449, fixture_id=9).one()
    assert removed.is_current is False
    frame, _ = modeling._build_next_gameweek_dataframe(session)
    assert frame[frame.player_id == 449].iloc[0]["games_played"] == 8


def test_bootstrap_identity_validation_rejects_duplicates_and_empty_rosters():
    from data.identity import validate_bootstrap
    bootstrap, _, _ = official_data()
    bootstrap["elements"].append(bootstrap["elements"][0].copy())
    with pytest.raises(ValueError, match="Duplicate"):
        validate_bootstrap(bootstrap)
    bootstrap["elements"] = []
    with pytest.raises(ValueError, match="empty"):
        validate_bootstrap(bootstrap)


def test_missing_target_fixture_fails_independent_schedule_verification(warehouse, monkeypatch):
    from database import repository
    session, bootstrap = warehouse
    data = official_data()
    data[1].pop()
    ingest_official_data(monkeypatch, session, data)
    modeling.train_and_score(session)
    official_fixtures = official_data()[1]
    monkeypatch.setattr(repository, "get_fixtures", lambda: official_fixtures)
    assert fetch_latest_predictions(session) == []
    with pytest.raises(RuntimeError, match="fixture schedule"):
        verify_refresh(session, bootstrap, official_fixtures)


@pytest.mark.parametrize("fault", ["expired", "future", "wrong_target", "nonfinite"])
def test_http_reads_fail_closed_for_invalid_forecasts(warehouse, monkeypatch, fault):
    from contextlib import contextmanager
    from fastapi.testclient import TestClient
    import main
    session, _ = warehouse

    @contextmanager
    def test_session():
        yield session

    monkeypatch.setattr(main, "get_session", test_session)
    monkeypatch.setattr(main, "init_db", lambda: None)
    with TestClient(main.app) as client:
        assert client.get("/api/predict?limit=700").status_code == 200
        rows = session.query(ModelPrediction).all()
        for row in rows:
            if fault == "expired":
                row.prediction_timestamp = datetime.now(timezone.utc) - timedelta(days=2)
            elif fault == "future":
                row.prediction_timestamp = datetime.now(timezone.utc) + timedelta(days=1)
            elif fault == "wrong_target":
                row.target_gameweek = 1
            else:
                row.predicted_points = float("inf")
        session.commit()
        assert client.get("/api/predict?limit=700").status_code == 503
        assert client.get("/api/players?limit=700").status_code == 503
