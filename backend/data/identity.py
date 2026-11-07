"""Identity checks for official FPL snapshots; no inferred cross-season joins."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any

INTEGRITY_VERSION = 1


def get_season_key(bootstrap: dict[str, Any]) -> str:
    deadlines = [event["deadline_time"] for event in bootstrap.get("events", [])
                 if event.get("deadline_time")]
    if not deadlines:
        raise ValueError("Official FPL events do not establish a season.")
    start_year = min(datetime.fromisoformat(value.replace("Z", "+00:00"))
                     for value in deadlines).year
    return f"{start_year}/{str(start_year + 1)[-2:]}"


def roster_fingerprint(elements: list[dict]) -> str:
    identities = sorted((p["id"], p["code"], p["first_name"], p["second_name"],
                         p["team"], p["element_type"], p["web_name"]) for p in elements)
    return hashlib.sha256(json.dumps(identities, ensure_ascii=False).encode()).hexdigest()


def validate_bootstrap(bootstrap: dict) -> str:
    season = get_season_key(bootstrap)
    players = bootstrap.get("elements", [])
    teams = bootstrap.get("teams", [])
    if not players or not teams:
        raise ValueError("Refusing an empty official roster.")
    team_ids = {team["id"] for team in teams}
    if len(team_ids) != len(teams):
        raise ValueError("Duplicate official team IDs.")
    ids, codes = set(), set()
    for player in players:
        pid, code = player.get("id"), player.get("code")
        if type(pid) is not int or pid <= 0 or type(code) is not int or code <= 0:
            raise ValueError("Every official registration requires a positive ID and person code.")
        if pid in ids or code in codes:
            raise ValueError("Duplicate official player IDs or person codes.")
        if player.get("team") not in team_ids or player.get("element_type") not in {1, 2, 3, 4}:
            raise ValueError("Invalid official player team or position.")
        if not player.get("first_name") or not player.get("second_name") or not player.get("web_name"):
            raise ValueError("Official player identity is incomplete.")
        ids.add(pid)
        codes.add(code)
    return season



def fixture_fingerprint(fixtures: list[dict]) -> str:
    # Scores/finished flags change during a match; identity, scheduling and
    # difficulty are the context a next-week forecast must agree with.
    schedule = sorted((f["id"], f.get("event"), f["team_h"], f["team_a"],
                       f.get("kickoff_time"), f.get("team_h_difficulty"),
                       f.get("team_a_difficulty")) for f in fixtures)
    return hashlib.sha256(json.dumps(schedule).encode()).hexdigest()


def validate_fixtures(fixtures: list[dict], bootstrap: dict) -> None:
    if not fixtures or len({f.get("id") for f in fixtures}) != len(fixtures):
        raise ValueError("Official fixtures are empty or contain duplicate IDs.")
    teams = {team["id"] for team in bootstrap["teams"]}
    events = {event["id"] for event in bootstrap["events"]}
    for fixture in fixtures:
        if (type(fixture.get("id")) is not int or fixture["id"] <= 0
                or fixture.get("team_h") not in teams or fixture.get("team_a") not in teams
                or fixture["team_h"] == fixture["team_a"]
                or (fixture.get("event") is not None and fixture["event"] not in events)
                or type(fixture.get("finished")) is not bool):
            raise ValueError("Invalid official fixture identity or gameweek.")
        for field in ("team_h_difficulty", "team_a_difficulty"):
            if fixture.get(field) not in {1, 2, 3, 4, 5}:
                raise ValueError("Invalid official fixture difficulty.")
        if fixture.get("kickoff_time"):
            datetime.fromisoformat(fixture["kickoff_time"].replace("Z", "+00:00"))
