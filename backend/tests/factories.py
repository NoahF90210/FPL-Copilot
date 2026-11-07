"""Small, explicitly synthetic official-API fixtures for unit tests."""
from copy import deepcopy
from datetime import datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from data.identity import INTEGRITY_VERSION, roster_fingerprint
from database.models import Base, Player
from database.repository import save_pipeline_run
from pipeline import ingest
from database import repository

SEASON = "2026/27"


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def official_data():
    bootstrap = {
        "events": [dict(id=gw, deadline_time=f"2026-08-{gw:02d}T11:00:00Z",
                        is_current=gw == 10, is_next=gw == 11) for gw in range(1, 13)],
        "teams": [
            {"id": 1, "name": "Example FC", "short_name": "EX"},
            {"id": 2, "name": "Opponent FC", "short_name": "OP"},
        ],
        "elements": [
            {"id": 606, "code": 569577, "first_name": "Triston", "second_name": "Rowe",
             "web_name": "Rowe", "team": 1, "element_type": 2, "now_cost": 40,
             "status": "a", "minutes": 0},
            {"id": 449, "code": 487838, "first_name": "Lewis", "second_name": "Hall",
             "web_name": "Hall", "team": 2, "element_type": 2, "now_cost": 53,
             "status": "a", "minutes": 810},
        ],
    }
    fixtures = [dict(id=gw, event=gw, team_h=1, team_a=2, finished=gw < 10,
                     kickoff_time=f"2026-09-{gw:02d}T14:00:00Z",
                     team_h_difficulty=2, team_a_difficulty=4)
                for gw in range(1, 12)]
    summaries = {}
    for player in bootstrap["elements"]:
        summaries[player["id"]] = {"history": [
            dict(round=gw, fixture=gw, was_home=player["team"] == 1,
                 opponent_team=2 if player["team"] == 1 else 1,
                 minutes=0 if player["id"] == 606 else 90,
                 total_points=0 if player["id"] == 606 else (gw % 4) + 2)
            for gw in range(1, 11)
        ]}
    return bootstrap, fixtures, summaries


def ingest_official_data(monkeypatch, session, data=None):
    bootstrap, fixtures, summaries = deepcopy(data or official_data())
    monkeypatch.setattr(repository, "get_bootstrap", lambda: bootstrap)
    monkeypatch.setattr(repository, "get_fixtures", lambda: fixtures)
    monkeypatch.setattr(ingest, "get_bootstrap", lambda: bootstrap)
    monkeypatch.setattr(ingest, "get_fixtures", lambda: fixtures)
    monkeypatch.setattr(ingest, "get_element_summary", lambda pid: summaries[pid])
    return ingest.run_ingestion(session)


def record_snapshot(session):
    players = list(session.scalars(select(Player).where(Player.is_current.is_(True))))
    identities = [dict(id=p.id, code=p.fpl_code, first_name=p.first_name,
                       second_name=p.second_name, team=p.team_id, element_type=p.position_id,
                       web_name=p.web_name)
                  for p in players]
    run = save_pipeline_run(
        session, run_type="ingestion", status="success", completed_at=datetime.now(timezone.utc),
        metadata_json=dict(integrity_version=INTEGRITY_VERSION, season=SEASON,
                           roster_count=len(players), roster_fingerprint=roster_fingerprint(identities)),
    )
    session.commit()
    return run
