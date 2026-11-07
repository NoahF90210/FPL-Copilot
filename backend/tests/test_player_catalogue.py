import json
from pathlib import Path

from fastapi.testclient import TestClient

import main
from data import player_catalogue
from factories import SEASON, official_data


def test_catalogue_is_independent_of_database_and_model(monkeypatch):
    bootstrap, _, _ = official_data()
    monkeypatch.setattr(player_catalogue, "get_bootstrap", lambda: bootstrap)
    monkeypatch.setattr(main, "init_db", lambda: None)

    def no_database():
        raise AssertionError("The player catalogue must not access the database")

    monkeypatch.setattr(main, "get_session", no_database)
    with TestClient(main.app) as client:
        response = client.get("/api/player-catalogue")
    assert response.status_code == 200
    payload = response.json()
    assert payload["season"] == SEASON
    assert payload["source"] == "official_fpl"
    assert payload["total"] == len(payload["players"]) == 2
    rowe = next(p for p in payload["players"] if p["id"] == 606)
    assert rowe["player_code"] == 569577
    assert rowe["full_name"] == "Triston Rowe"
    assert rowe["price"] == 4
    assert all("predicted_points" not in player for player in payload["players"])


def test_catalogue_failure_is_safe_and_not_an_empty_success(monkeypatch):
    def unavailable():
        raise ConnectionError("secret-bearing exception")

    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(main, "fetch_player_catalogue", unavailable)
    with TestClient(main.app) as client:
        response = client.get("/api/player-catalogue")
    assert response.status_code == 503
    assert "secret-bearing" not in response.text
    assert "temporarily unavailable" in response.json()["detail"]


def test_catalogue_keeps_upstream_capture_time(monkeypatch):
    monkeypatch.setattr(player_catalogue, "get_bootstrap", lambda: official_data()[0])
    monkeypatch.setitem(player_catalogue.CACHE, "bootstrap", (official_data()[0], 1794078000))
    assert player_catalogue.fetch_player_catalogue()["fetched_at"] == "2026-11-07T19:00:00+00:00"


def test_bundled_snapshot_is_real_descriptive_data_with_provenance():
    path = Path(__file__).resolve().parents[2] / "frontend/data/player-catalogue.json"
    snapshot = json.loads(path.read_text())
    assert snapshot["source"] == "snapshot"
    assert snapshot["source_url"] == "https://fantasy.premierleague.com/api/bootstrap-static/"
    assert snapshot["fetched_at"]
    assert snapshot["season"]
    assert snapshot["total"] == len(snapshot["players"]) > 0
    assert len({p["id"] for p in snapshot["players"]}) == snapshot["total"]
    assert len({p["player_code"] for p in snapshot["players"]}) == snapshot["total"]
    assert all("predicted_points" not in p and "target_gameweek" not in p for p in snapshot["players"])
