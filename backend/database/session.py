from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import MetaData, create_engine, inspect, text
from sqlalchemy.schema import CreateTable
from sqlalchemy.orm import Session, sessionmaker

from core.config import get_settings
from database.models import Base
from database.security import secure_warehouse_tables


settings = get_settings()
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
elif settings.database_url.startswith("postgresql"):
    connect_args = {"connect_timeout": 5}
else:
    connect_args = {}
engine_options = {"isolation_level": "REPEATABLE READ"} if settings.database_url.startswith("postgresql") else {}
engine = create_engine(settings.database_url, future=True, pool_pre_ping=True,
                       connect_args=connect_args, **engine_options)
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


def _migrate_sqlite_season_constraints() -> None:
    if engine.dialect.name != "sqlite":
        return
    inspector = inspect(engine)
    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        table.to_metadata(metadata)
    # SQLite cannot drop a table-level UNIQUE constraint. Rebuild only these
    # leaf tables transactionally, copying every existing column and row.
    for name, old_columns in (
        ("player_gameweek_stats", {"player_id", "fixture_id"}),
        ("team_gameweek_stats", {"team_id", "gameweek"}),
    ):
        constraints = inspector.get_unique_constraints(name)
        if not any(set(c["column_names"]) == old_columns for c in constraints):
            continue
        temporary = f"{name}_season_upgrade"
        replacement = Base.metadata.tables[name].to_metadata(metadata, name=temporary)
        columns = ", ".join(f'"{c["name"]}"' for c in inspector.get_columns(name))
        with engine.begin() as conn:
            # sqlite3 legacy transaction mode otherwise autocommits CREATE TABLE.
            conn.exec_driver_sql("BEGIN")
            conn.execute(CreateTable(replacement))
            conn.execute(text(f'INSERT INTO "{temporary}" ({columns}) SELECT {columns} FROM "{name}"'))
            conn.execute(text(f'DROP TABLE "{name}"'))
            conn.execute(text(f'ALTER TABLE "{temporary}" RENAME TO "{name}"'))
            for index in Base.metadata.tables[name].indexes:
                index.create(bind=conn, checkfirst=True)


def _migrate_verified_identity() -> None:
    # Old rows stay unverified until an official ingestion establishes identity.
    additions = {
        "players": {
            "fpl_code": "INTEGER", "season": "VARCHAR(9)",
            "is_current": "BOOLEAN NOT NULL DEFAULT FALSE",
        },
        "fixtures": {"season": "VARCHAR(9)", "is_current": "BOOLEAN NOT NULL DEFAULT FALSE"},
        "player_gameweek_stats": {
            "player_code": "INTEGER", "is_current": "BOOLEAN NOT NULL DEFAULT FALSE",
        },
    }
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in additions.items():
            existing = {column["name"] for column in inspector.get_columns(table)}
            for name, definition in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}"))


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate_player_gameweek_constraint()
    _migrate_sqlite_season_constraints()
    _migrate_verified_identity()
    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            secure_warehouse_tables(connection)


@contextmanager
def get_session() -> Session:
    session = SessionLocal()
    try:
        # sqlite3's legacy mode does not BEGIN on SELECT. Make every public
        # request a consistent read snapshot, matching PostgreSQL repeatable-read.
        if session.get_bind().dialect.name == "sqlite":
            session.connection().exec_driver_sql("BEGIN")
        yield session
    finally:
        session.close()
