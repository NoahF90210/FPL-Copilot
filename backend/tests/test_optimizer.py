from models.optimizer import optimize_squad


def _player(
    player_id: int,
    position: str,
    team_id: int,
    predicted_points: float,
    price: float = 5.0,
    status: str = "a",
):
    position_id = {"GKP": 1, "DEF": 2, "MID": 3, "FWD": 4}[position]
    return {
        "id": player_id,
        "name": f"{position}-{player_id}",
        "position": position,
        "position_id": position_id,
        "team_id": team_id,
        "team_short": f"T{team_id}",
        "predicted_points": predicted_points,
        "price": price,
        "status": status,
    }


def _base_player_pool():
    players = []
    current_ids = []
    player_id = 1
    team_pattern = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 1, 2, 3, 4, 5]

    for position, count in [("GKP", 2), ("DEF", 5), ("MID", 5), ("FWD", 3)]:
        for _ in range(count):
            players.append(
                _player(
                    player_id=player_id,
                    position=position,
                    team_id=team_pattern[player_id - 1],
                    predicted_points=5.0,
                )
            )
            current_ids.append(player_id)
            player_id += 1

    players.extend(
        [
            _player(player_id=101, position="DEF", team_id=6, predicted_points=10.0),
            _player(player_id=102, position="MID", team_id=6, predicted_points=8.0),
            _player(player_id=103, position="FWD", team_id=7, predicted_points=8.0),
        ]
    )
    return players, current_ids


def test_optimizer_prefers_single_upgrade_when_hits_outweigh_extra_swaps():
    players, current_ids = _base_player_pool()

    result = optimize_squad(
        players=players,
        budget=100.0,
        current_squad_player_ids=current_ids,
        free_transfers=1,
        apply_transfer_penalty=True,
    )

    selected_ids = {player["id"] for player in result["squad"]}
    swapped_in = selected_ids - set(current_ids)

    assert result["status"] == "optimal"
    assert swapped_in == {101}
    assert result["transfer_count"] == 1
    assert result["paid_transfers"] == 0
    assert result["hit_cost"] == 0


def test_optimizer_takes_all_upgrades_when_transfer_penalty_is_off():
    players, current_ids = _base_player_pool()

    result = optimize_squad(
        players=players,
        budget=100.0,
        current_squad_player_ids=current_ids,
        free_transfers=1,
        apply_transfer_penalty=False,
    )

    selected_ids = {player["id"] for player in result["squad"]}
    swapped_in = selected_ids - set(current_ids)

    assert result["status"] == "optimal"
    assert swapped_in == {101, 102, 103}
    assert result["transfer_count"] == 0
    assert result["hit_cost"] == 0


def test_optimizer_reports_paid_transfers_when_multiple_moves_are_worth_it():
    players, current_ids = _base_player_pool()
    players.extend(
        [
            _player(player_id=104, position="DEF", team_id=8, predicted_points=14.0),
            _player(player_id=105, position="MID", team_id=8, predicted_points=13.0),
        ]
    )

    result = optimize_squad(
        players=players,
        budget=100.0,
        current_squad_player_ids=current_ids,
        free_transfers=1,
        apply_transfer_penalty=True,
    )

    assert result["status"] == "optimal"
    assert result["transfer_count"] >= 2
    assert result["paid_transfers"] == max(0, result["transfer_count"] - 1)
    assert result["hit_cost"] == result["paid_transfers"] * 4.0
