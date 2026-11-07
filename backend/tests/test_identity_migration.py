from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateTable

from database.models import Base, PlayerGameweekStat, TeamGameweekStat

from database import session as database_session


def test_additive_identity_migration_preserves_and_quarantines_legacy_rows(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE players (id INTEGER PRIMARY KEY, full_name VARCHAR(200))"))
        conn.execute(text("INSERT INTO players VALUES (606, 'Historical Player')"))
        conn.execute(text("CREATE TABLE fixtures (id INTEGER PRIMARY KEY)"))
        conn.execute(text("INSERT INTO fixtures VALUES (1)"))
        conn.execute(text("CREATE TABLE player_gameweek_stats "
                          "(id INTEGER PRIMARY KEY, player_id INTEGER, fixture_id INTEGER)"))
        conn.execute(text("INSERT INTO player_gameweek_stats VALUES (1, 606, 1)"))
        conn.execute(text("CREATE TABLE team_gameweek_stats (id INTEGER PRIMARY KEY)"))
    monkeypatch.setattr(database_session, "engine", engine)
    # Run twice: additive schema upgrades must be safe to retry after startup.
    database_session.init_db()
    database_session.init_db()
    with engine.connect() as conn:
        player = conn.execute(text("SELECT full_name, fpl_code, season, is_current FROM players")).one()
        assert tuple(player) == ("Historical Player", None, None, 0)
        stat = conn.execute(text("SELECT player_id, season, player_code FROM player_gameweek_stats")).one()
        assert tuple(stat) == (606, "legacy", None)
        assert conn.execute(text("SELECT season, is_current FROM fixtures")).one() == (None, 0)
    assert {"fpl_code", "season", "is_current"} <= {
        column["name"] for column in inspect(engine).get_columns("players")
    }


def test_sqlite_old_unique_constraints_become_season_scoped(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'old-constraints.db'}")
    Base.metadata.create_all(engine)
    for table_name, new_constraint, old_constraint in [
        ("player_gameweek_stats", "uq_player_fixture_season UNIQUE (player_id, fixture_id, season)",
         "uq_player_fixture UNIQUE (player_id, fixture_id)"),
        ("team_gameweek_stats", "uq_team_gameweek_season UNIQUE (team_id, gameweek, season)",
         "uq_team_gameweek UNIQUE (team_id, gameweek)"),
    ]:
        ddl = str(CreateTable(Base.metadata.tables[table_name]).compile(engine))
        assert new_constraint in ddl
        with engine.begin() as conn:
            conn.execute(text(f"DROP TABLE {table_name}"))
            conn.execute(text(ddl.replace(new_constraint, old_constraint)))
    with Session(engine) as session:
        session.add(PlayerGameweekStat(player_id=606, team_id=1, fixture_id=1,
                                      season="legacy", gameweek=1, total_points=99))
        session.add(TeamGameweekStat(team_id=1, gameweek=1, season="legacy"))
        session.commit()
    monkeypatch.setattr(database_session, "engine", engine)
    database_session.init_db()
    database_session.init_db()
    with Session(engine) as session:
        assert session.query(PlayerGameweekStat).one().total_points == 99
        session.add(PlayerGameweekStat(player_id=606, team_id=1, fixture_id=1,
                                      season="2026/27", gameweek=1, total_points=0))
        session.add(TeamGameweekStat(team_id=1, gameweek=1, season="2026/27"))
        session.commit()
        assert session.query(PlayerGameweekStat).count() == 2
        assert session.query(TeamGameweekStat).count() == 2
