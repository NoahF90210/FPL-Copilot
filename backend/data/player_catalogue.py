"""Descriptive official player stats, independent of the forecast warehouse."""
from __future__ import annotations

from datetime import datetime, timezone

from data.fpl_client import CACHE, build_player_list, get_bootstrap
from data.identity import validate_bootstrap


CATALOGUE_FIELDS = (
    "id", "name", "full_name", "team", "team_short", "position", "price", "form",
    "total_points", "selected_by_percent", "ict_index", "minutes", "status",
)


def fetch_player_catalogue() -> dict:
    bootstrap = get_bootstrap()
    season = validate_bootstrap(bootstrap)
    # Use the actual upstream cache timestamp, not the time this response is served.
    cached_at = CACHE.get("bootstrap", (None, datetime.now(timezone.utc).timestamp()))[1]
    codes = {player["id"]: player["code"] for player in bootstrap["elements"]}
    players = [
        {**{key: player[key] for key in CATALOGUE_FIELDS}, "player_code": codes[player["id"]]}
        for player in build_player_list(bootstrap)
    ]
    return {
        "players": players,
        "total": len(players),
        "season": season,
        "fetched_at": datetime.fromtimestamp(cached_at, timezone.utc).isoformat(),
        "source": "official_fpl",
        "source_url": "https://fantasy.premierleague.com/api/bootstrap-static/",
    }
