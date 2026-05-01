from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from core.config import get_settings
from database.models import Base


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, future=True, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def _migrate_player_gameweek_constraint() -> None:
    if engine.dialect.name != "postgresql":
        return

    inspector = inspect(engine)
    if "player_gameweek_stats" not in inspector.get_table_names():
        return

    unique_constraints = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints("player_gameweek_stats")
        if constraint.get("name")
    }

    with engine.begin() as conn:
        if "uq_player_gameweek" in unique_constraints:
            conn.execute(text("ALTER TABLE player_gameweek_stats DROP CONSTRAINT uq_player_gameweek"))
        if "uq_player_fixture" not in unique_constraints:
            conn.execute(
                text(
                    "ALTER TABLE player_gameweek_stats "
                    "ADD CONSTRAINT uq_player_fixture UNIQUE (player_id, fixture_id)"
                )
            )


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate_player_gameweek_constraint()


@contextmanager
def get_session() -> Session:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
