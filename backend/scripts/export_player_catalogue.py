"""Refresh the real, descriptive roster bundled with the players page (no DB writes)."""
from __future__ import annotations

import json
from pathlib import Path

from _cli import prepare_backend_path


def main() -> None:
    prepare_backend_path()
    from data.player_catalogue import fetch_player_catalogue

    payload = {**fetch_player_catalogue(), "source": "snapshot"}
    output = Path(__file__).resolve().parents[2] / "frontend/data/player-catalogue.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(f"Exported {payload['total']} official players for {payload['season']} as of {payload['fetched_at']}")


if __name__ == "__main__":
    main()
