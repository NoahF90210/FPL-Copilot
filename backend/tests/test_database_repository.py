from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from database.models import Base, PipelineRun, Team
from database.repository import fetch_model_status, serialize_pipeline_run, upsert_model


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, future=True)
    return factory()


def test_upsert_model_creates_and_updates_team():
    session = make_session()

    team, created = upsert_model(session, Team, {"name": "Arsenal", "short_name": "ARS"}, id=1)
    assert created is True
    session.commit()

    updated_team, created = upsert_model(session, Team, {"name": "Arsenal FC", "short_name": "ARS"}, id=1)
    assert created is False
    assert updated_team.name == "Arsenal FC"


def test_fetch_model_status_returns_latest_runs():
    session = make_session()
    session.add(
        PipelineRun(
            run_type="ingestion",
            status="success",
            rows_inserted=10,
            rows_updated=2,
            started_at=datetime.utcnow(),
            completed_at=datetime.utcnow(),
        )
    )
    session.commit()

    status = fetch_model_status(session)
    assert status["latest_ingestion_run"]["status"] == "success"


def test_serialize_pipeline_run_handles_none():
    assert serialize_pipeline_run(None) is None
