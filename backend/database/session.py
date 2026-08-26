from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from core.config import get_settings
from database.models import Base


settings = get_settings()
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
elif settings.database_url.startswith("postgresql"):
    connect_args = {"connect_timeout": 5}
else:
    connect_args = {}
engine = create_engine(settings.database_url, future=True, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def _migrate_player_gameweek_constraint() -> None:
    if engine.dialect.name not in {"postgresql", "sqlite"}:
        return

    inspector = inspect(engine)
    if "player_gameweek_stats" not in inspector.get_table_names():
        return

    with engine.begin() as conn:
        columns = {column["name"] for column in inspector.get_columns("player_gameweek_stats")}
        if "season" not in columns:
            conn.execute(text("ALTER TABLE player_gameweek_stats ADD COLUMN season VARCHAR(9) NOT NULL DEFAULT 'legacy'"))

        if engine.dialect.name == "postgresql":
            unique_constraints = {
                constraint["name"]
                for constraint in inspector.get_unique_constraints("player_gameweek_stats")
                if constraint.get("name")
            }
            if "uq_player_fixture" in unique_constraints:
                conn.execute(text("ALTER TABLE player_gameweek_stats DROP CONSTRAINT uq_player_fixture"))
            if "uq_player_fixture_season" not in unique_constraints:
                conn.execute(
                    text(
                        "ALTER TABLE player_gameweek_stats "
                        "ADD CONSTRAINT uq_player_fixture_season UNIQUE (player_id, fixture_id, season)"
                    )
                )

        team_columns = {column["name"] for column in inspector.get_columns("team_gameweek_stats")}
        if "season" not in team_columns:
            conn.execute(text("ALTER TABLE team_gameweek_stats ADD COLUMN season VARCHAR(9) NOT NULL DEFAULT 'legacy'"))
        if engine.dialect.name == "postgresql":
            team_constraints = {
                constraint["name"]
                for constraint in inspector.get_unique_constraints("team_gameweek_stats")
                if constraint.get("name")
            }
            if "uq_team_gameweek" in team_constraints:
                conn.execute(text("ALTER TABLE team_gameweek_stats DROP CONSTRAINT uq_team_gameweek"))
            if "uq_team_gameweek_season" not in team_constraints:
                conn.execute(
                    text(
                        "ALTER TABLE team_gameweek_stats "
                        "ADD CONSTRAINT uq_team_gameweek_season UNIQUE (team_id, gameweek, season)"
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
