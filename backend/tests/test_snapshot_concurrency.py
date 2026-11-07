"""A real two-connection interleaving must not mix roster snapshots."""
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from database import repository, session as database_session
from database.models import Base, ModelPrediction, Player
from database.repository import hydrate_prediction_context
from factories import ingest_official_data, official_data
from pipeline import modeling
from types import SimpleNamespace


def test_api_read_stays_on_one_snapshot_during_concurrent_ingestion(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'concurrency.db'}")
    with engine.connect() as conn:
        conn.exec_driver_sql("PRAGMA journal_mode=WAL")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(database_session, "SessionLocal", sessionmaker(bind=engine))
    bootstrap, _, _ = official_data()
    with Session(engine) as writer:
        ingest_official_data(monkeypatch, writer)
        monkeypatch.setattr(modeling, "get_bootstrap", lambda: bootstrap)
        monkeypatch.setattr(modeling, "settings", SimpleNamespace(
            reports_dir=tmp_path, model_artifact_path=tmp_path / "model.joblib",
            evaluation_report_path=tmp_path / "evaluation.json",
            latest_predictions_path=tmp_path / "predictions.json",
        ))
        monkeypatch.setattr(modeling, "_log_training_run_to_mlflow", lambda **kwargs: None)
        modeling.train_and_score(writer)
    original = repository.verified_prediction_batch
    interleaved = []

    def concurrent_commit(reader):
        batch = original(reader)
        assert batch
        # Ingestion changes an ID's identity and invalidates the old predictions
        # after validation but before the final profile/context selects.
        with Session(engine) as writer:
            player = writer.get(Player, 606)
            player.first_name = "Different"
            player.full_name = "Different Person"
            player.fpl_code = 12345
            writer.query(ModelPrediction).delete()
            writer.commit()
        interleaved.append(True)
        return batch

    monkeypatch.setattr(repository, "verified_prediction_batch", concurrent_commit)
    with database_session.get_session() as reader:
        players = repository.fetch_latest_predictions(reader)
        hydrated = hydrate_prediction_context(reader, players)
        rowe = next(p for p in hydrated if p["id"] == 606)
        assert rowe["full_name"] == "Triston Rowe"
        assert rowe["player_code"] == 569577
        assert rowe["next_opponent"] == "OP"
    assert interleaved == [True]
    with Session(engine) as writer:
        assert writer.get(Player, 606).fpl_code == 12345
        assert writer.query(ModelPrediction).count() == 0
