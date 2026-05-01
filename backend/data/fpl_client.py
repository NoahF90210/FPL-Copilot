"""
FPL API client with in-memory caching (5-minute TTL).
"""
import time
from typing import Any
import httpx

BASE = "https://fantasy.premierleague.com/api"
HEADERS = {"User-Agent": "FPL-Copilot/1.0"}
CACHE: dict[str, tuple[Any, float]] = {}
TTL = 300  # 5 minutes


def _cached(key: str, fn):
    now = time.time()
    if key in CACHE and now - CACHE[key][1] < TTL:
        return CACHE[key][0]
    result = fn()
    CACHE[key] = (result, now)
    return result


def get_bootstrap() -> dict:
    def fetch():
        with httpx.Client(headers=HEADERS, timeout=30) as c:
            r = c.get(f"{BASE}/bootstrap-static/")
            r.raise_for_status()
            return r.json()
    return _cached("bootstrap", fetch)


def get_fixtures() -> list:
    def fetch():
        with httpx.Client(headers=HEADERS, timeout=30) as c:
            r = c.get(f"{BASE}/fixtures/")
            r.raise_for_status()
            return r.json()
    return _cached("fixtures", fetch)


def get_element_summary(player_id: int) -> dict:
    key = f"element_{player_id}"
    def fetch():
        with httpx.Client(headers=HEADERS, timeout=30) as c:
            r = c.get(f"{BASE}/element-summary/{player_id}/")
            r.raise_for_status()
            return r.json()
    return _cached(key, fetch)


def get_current_gameweek(bootstrap: dict) -> int:
    for event in bootstrap["events"]:
        if event.get("is_current"):
            return event["id"]
    for event in bootstrap["events"]:
        if event.get("is_next"):
            return event["id"]
    return 1


def get_team_map(bootstrap: dict) -> dict[int, dict]:
    return {t["id"]: t for t in bootstrap["teams"]}


def build_player_list(bootstrap: dict) -> list[dict]:
    """Return enriched player dicts from bootstrap data."""
    team_map = get_team_map(bootstrap)
    pos_map = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}

    players = []
    for el in bootstrap["elements"]:
        team = team_map.get(el["team"], {})
        players.append({
            "id": el["id"],
            "name": el["web_name"],
            "full_name": f"{el['first_name']} {el['second_name']}",
            "team": team.get("name", ""),
            "team_id": el["team"],
            "team_short": team.get("short_name", ""),
            "position": pos_map.get(el["element_type"], "UNK"),
            "position_id": el["element_type"],
            "price": el["now_cost"] / 10,
            "form": float(el.get("form") or 0),
            "total_points": el.get("total_points", 0),
            "selected_by_percent": float(el.get("selected_by_percent") or 0),
            "minutes": el.get("minutes", 0),
            "goals_scored": el.get("goals_scored", 0),
            "assists": el.get("assists", 0),
            "clean_sheets": el.get("clean_sheets", 0),
            "goals_conceded": el.get("goals_conceded", 0),
            "yellow_cards": el.get("yellow_cards", 0),
            "red_cards": el.get("red_cards", 0),
            "saves": el.get("saves", 0),
            "bonus": el.get("bonus", 0),
            "bps": el.get("bps", 0),
            "ict_index": float(el.get("ict_index") or 0),
            "influence": float(el.get("influence") or 0),
            "creativity": float(el.get("creativity") or 0),
            "threat": float(el.get("threat") or 0),
            "expected_goals": float(el.get("expected_goals") or 0),
            "expected_assists": float(el.get("expected_assists") or 0),
            "expected_goal_involvements": float(el.get("expected_goal_involvements") or 0),
            "chance_of_playing_next_round": el.get("chance_of_playing_next_round"),
            "news": el.get("news", ""),
            "status": el.get("status", "a"),
        })
    return players


def get_next_fixture_fdr(bootstrap: dict, fixtures: list) -> dict[int, list[dict]]:
    """Return mapping of team_id -> list of next 3 fixture info dicts."""
    current_gw = get_current_gameweek(bootstrap)

    # Group upcoming fixtures by team
    team_fixtures: dict[int, list[dict]] = {}
    upcoming = [f for f in fixtures if not f.get("finished") and f.get("event")]

    for fix in sorted(upcoming, key=lambda x: x["event"]):
        gw = fix["event"]
        if gw < current_gw:
            continue

        for side, opp_side, home in [("team_h", "team_a", True), ("team_a", "team_h", False)]:
            team_id = fix[side]
            team_fixtures.setdefault(team_id, [])
            if len(team_fixtures[team_id]) < 3:
                team_fixtures[team_id].append({
                    "gameweek": gw,
                    "opponent_id": fix[opp_side],
                    "home": home,
                    "fdr": fix["team_h_difficulty"] if home else fix["team_a_difficulty"],
                })

    return team_fixtures
