"""
Squad optimizer using linear programming (PuLP).

Constraints:
  - Budget ≤ £100m
  - 2 GKP, 5 DEF, 5 MID, 3 FWD
  - Max 3 players from any single club
  - Optional must_include / must_exclude player ID lists
  - Optional transfer-aware penalty for moves beyond free transfers
"""
from __future__ import annotations

import pulp


def optimize_squad(
    players: list[dict],
    budget: float = 100.0,
    must_include: list[int] | None = None,
    must_exclude: list[int] | None = None,
    current_squad_player_ids: list[int] | None = None,
    free_transfers: int = 0,
    apply_transfer_penalty: bool = False,
    transfer_hit_cost: float = 4.0,
) -> dict:
    must_include = set(must_include or [])
    must_exclude = set(must_exclude or [])
    current_squad_player_ids = set(current_squad_player_ids or [])

    eligible = [p for p in players if p["id"] not in must_exclude and p.get("status") != "u"]

    prob = pulp.LpProblem("FPL_Squad", pulp.LpMaximize)

    # Binary decision variables
    x = {p["id"]: pulp.LpVariable(f"x_{p['id']}", cat="Binary") for p in eligible}
    transfer_count = None
    paid_transfers = None

    if apply_transfer_penalty and current_squad_player_ids:
        current_in_pool = [pid for pid in current_squad_player_ids if pid in x]
        kept_current = pulp.lpSum(x[pid] for pid in current_in_pool)
        transfer_count = pulp.LpVariable("transfer_count", lowBound=0, cat="Integer")
        paid_transfers = pulp.LpVariable("paid_transfers", lowBound=0, cat="Integer")
        prob += transfer_count == 15 - kept_current
        prob += paid_transfers >= transfer_count - max(0, free_transfers)
        objective_penalty = transfer_hit_cost * paid_transfers
    else:
        objective_penalty = 0

    # Objective: maximise predicted points, minus any transfer hit penalty.
    prob += pulp.lpSum(p["predicted_points"] * x[p["id"]] for p in eligible) - objective_penalty

    # Budget constraint (prices in £m)
    prob += pulp.lpSum(p["price"] * x[p["id"]] for p in eligible) <= budget

    # Position constraints
    for pos, count in [("GKP", 2), ("DEF", 5), ("MID", 5), ("FWD", 3)]:
        pos_players = [p for p in eligible if p["position"] == pos]
        prob += pulp.lpSum(x[p["id"]] for p in pos_players) == count

    # Max 3 per club
    teams = {p["team_id"] for p in eligible}
    for team_id in teams:
        team_players = [p for p in eligible if p["team_id"] == team_id]
        prob += pulp.lpSum(x[p["id"]] for p in team_players) <= 3

    # Force must_include
    for pid in must_include:
        if pid in x:
            prob += x[pid] == 1

    prob.solve(pulp.PULP_CBC_CMD(msg=0))

    if pulp.LpStatus[prob.status] != "Optimal":
        return {"status": "infeasible", "squad": []}

    selected_ids = {pid for pid, var in x.items() if pulp.value(var) == 1}
    squad = [p for p in eligible if p["id"] in selected_ids]
    squad.sort(key=lambda p: (p["position_id"], -p["predicted_points"]))

    total_cost = round(sum(p["price"] for p in squad), 1)
    total_predicted = round(sum(p["predicted_points"] for p in squad), 2)
    transfer_count_value = int(round(pulp.value(transfer_count))) if transfer_count is not None else 0
    paid_transfers_value = int(round(pulp.value(paid_transfers))) if paid_transfers is not None else 0
    hit_cost = round(paid_transfers_value * transfer_hit_cost, 1)

    return {
        "status": "optimal",
        "total_cost": total_cost,
        "budget_remaining": round(budget - total_cost, 1),
        "total_predicted_points": total_predicted,
        "transfer_count": transfer_count_value,
        "paid_transfers": paid_transfers_value,
        "hit_cost": hit_cost,
        "squad": squad,
    }
