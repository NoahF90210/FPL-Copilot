"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import FDRBadge from "@/components/FDRBadge";
import { fetchJson } from "@/lib/api";
import {
  DEFAULT_TEAM_STATE,
  POSITION_LIMITS,
  POSITION_ORDER,
  deriveTeamState,
  isValidLineupPlayers,
  projectTeamPoints,
  type ChipMode,
  type FplPlayer,
} from "@/lib/fpl-rules";
import { useSavedSquad } from "@/lib/saved-squad";

type SquadPlayer = FplPlayer & {
  form: number;
  confidence: string;
  total_points: number;
  status: string;
};

const POS_COLORS: Record<string, string> = {
  GKP: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  DEF: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  MID: "bg-fpl-green/20 text-fpl-green border-fpl-green/30",
  FWD: "bg-red-500/20 text-red-400 border-red-500/30",
};

const CHIP_OPTIONS: Array<{ value: ChipMode; label: string }> = [
  { value: "none", label: "No chip" },
  { value: "wildcard", label: "Wildcard" },
  { value: "free_hit", label: "Free Hit" },
  { value: "bench_boost", label: "Bench Boost" },
  { value: "triple_captain", label: "Triple Captain" },
];

export default function SquadPage() {
  const [players, setPlayers] = useState<SquadPlayer[]>([]);
  const [search, setSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const squad = useSavedSquad();

  useEffect(() => {
    async function load() {
      try {
        setError("");
        const data = await fetchJson<{ predictions?: SquadPlayer[] }>("/api/predict?limit=700");
        const available = (data.predictions || []).filter((player) => player.status === "a");
        setPlayers(available);
      } catch (e: any) {
        setPlayers([]);
        setError(e.message || "Unable to load player predictions right now. Try again shortly.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const playerMap = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const selectedPlayers = useMemo(
    () =>
      squad.playerIds
        .map((playerId) => playerMap.get(playerId))
        .filter((player): player is SquadPlayer => Boolean(player)),
    [playerMap, squad.playerIds]
  );
  const derived = useMemo(() => deriveTeamState(squad, selectedPlayers), [selectedPlayers, squad]);
  const selectedIds = useMemo(
    () => new Set(selectedPlayers.map((player) => player.id)),
    [selectedPlayers]
  );
  const validation = useMemo(
    () => validateTeamState(selectedPlayers, derived.lineup, derived.benchOrder, derived.captain, derived.viceCaptain),
    [derived.benchOrder, derived.captain, derived.lineup, derived.viceCaptain, selectedPlayers]
  );
  const projections = useMemo(() => projectTeamPoints(squad, selectedPlayers), [selectedPlayers, squad]);
  const lineupByPosition = useMemo(
    () =>
      POSITION_ORDER.reduce<Record<string, SquadPlayer[]>>((acc, position) => {
        acc[position] = derived.lineup
          .filter((player) => player.position === position)
          .sort((a, b) => (b.predicted_points || 0) - (a.predicted_points || 0));
        return acc;
      }, {}),
    [derived.lineup]
  );

  const countsByPosition = useMemo(() => {
    return selectedPlayers.reduce<Record<string, number>>((acc, player) => {
      acc[player.position] = (acc[player.position] || 0) + 1;
      return acc;
    }, {});
  }, [selectedPlayers]);

  const filteredPlayers = useMemo(() => {
    const query = normalizeSearch(search);
    return players
      .filter((player) => !selectedIds.has(player.id))
      .filter((player) => positionFilter === "All" || player.position === positionFilter)
      .filter((player) => {
        if (!query) return true;
        const haystack = normalizeSearch(
          [player.name, player.team_short, player.position].filter(Boolean).join(" ")
        );
        return haystack.includes(query);
      })
      .sort((a, b) => (b.predicted_points || 0) - (a.predicted_points || 0));
  }, [players, positionFilter, search, selectedIds]);

  function addPlayer(player: SquadPlayer) {
    if (selectedIds.has(player.id)) return;
    if (selectedPlayers.length >= 15) {
      setError("Your squad is full. Remove a player before adding another.");
      return;
    }
    if ((countsByPosition[player.position] || 0) >= POSITION_LIMITS[player.position]) {
      setError(`You already have the maximum number of ${player.position} players.`);
      return;
    }
    const sameClubCount = selectedPlayers.filter(
      (selectedPlayer) =>
        (selectedPlayer.team_id ?? selectedPlayer.team_short) ===
        (player.team_id ?? player.team_short)
    ).length;
    if (sameClubCount >= 3) {
      setError("You can only own three players from one Premier League club.");
      return;
    }

    setError("");
    squad.addPlayerId(player.id);
  }

  function removePlayer(playerId: number) {
    squad.removePlayerId(playerId);
    setError("");
  }

  function autopickLineup() {
    squad.setLineupIds(derived.lineup.map((player) => player.id));
    squad.setBenchOrderIds(derived.benchOrder.map((player) => player.id));
    if (derived.captain) squad.setCaptainId(derived.captain.id);
    if (derived.viceCaptain) squad.setViceCaptainId(derived.viceCaptain.id);
  }

  function moveBenchPlayer(playerId: number, direction: -1 | 1) {
    const current = [...derived.benchOrder];
    const index = current.findIndex((player) => player.id === playerId);
    if (index === -1) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= current.length) return;
    [current[index], current[nextIndex]] = [current[nextIndex], current[index]];
    if (current[0]?.position !== "GKP") {
      setError("The first bench slot must stay with your backup goalkeeper.");
      return;
    }
    squad.setBenchOrderIds(current.map((player) => player.id));
  }

  function toggleStarter(playerId: number) {
    const starter = derived.lineup.find((player) => player.id === playerId);
    if (starter) {
      const replacement = derived.benchOrder.find((candidate) =>
        isValidLineupPlayers(
          derived.lineup
            .filter((player) => player.id !== playerId)
            .concat(candidate)
        )
      );
      if (!replacement) {
        setError("That swap would break the FPL formation rules.");
        return;
      }
      const nextLineup = derived.lineup
        .filter((player) => player.id !== playerId)
        .concat(replacement);
      const nextBench = [
        starter,
        ...derived.benchOrder.filter((player) => player.id !== replacement.id),
      ];
      squad.setLineupIds(nextLineup.map((player) => player.id));
      squad.setBenchOrderIds(nextBench.map((player) => player.id));
      return;
    }

    const benchPlayer = derived.benchOrder.find((player) => player.id === playerId);
    if (!benchPlayer) return;
    const replacement = [...derived.lineup]
      .sort((a, b) => (a.predicted_points || 0) - (b.predicted_points || 0))
      .find((candidate) =>
        isValidLineupPlayers(
          derived.lineup
            .filter((player) => player.id !== candidate.id)
            .concat(benchPlayer)
        )
      );
    if (!replacement) {
      setError("That swap would break the FPL formation rules.");
      return;
    }
    const nextLineup = derived.lineup
      .filter((player) => player.id !== replacement.id)
      .concat(benchPlayer);
    const nextBench = [
      replacement,
      ...derived.benchOrder.filter((player) => player.id !== benchPlayer.id),
    ];
    squad.setLineupIds(nextLineup.map((player) => player.id));
    squad.setBenchOrderIds(nextBench.map((player) => player.id));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-white">My Squad</h1>
        <p className="mt-0.5 text-sm text-fpl-muted">
          Save your full FPL team state here: 15 players, starting XI, bench order, captaincy, bank, transfers, and chip mode.
        </p>
      </div>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-fpl-border bg-fpl-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-green">Rule-aware squad builder</p>
                <h2 className="mt-2 text-xl font-bold text-white">Build your team around the real FPL rules</h2>
                <p className="mt-2 text-sm text-fpl-muted">
                  Your squad saves across pages and powers the optimizer, captaincy view, and dashboard insights.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {squad.hydrated && (
                  <span className="rounded-full border border-fpl-green/30 bg-fpl-green/10 px-3 py-1 text-xs font-semibold text-fpl-green">
                    {selectedPlayers.length
                      ? `Saved across pages${squad.savedAt ? ` · ${formatSavedAt(squad.savedAt)}` : ""}`
                      : "Ready to save your team"}
                  </span>
                )}
                <button
                  onClick={() => {
                    squad.clearSquad();
                    setError("");
                  }}
                  disabled={!selectedPlayers.length}
                  className="rounded-xl border border-fpl-border bg-fpl-bg px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-fpl-green/40 hover:text-fpl-green disabled:opacity-40"
                >
                  Clear team
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              <SummaryStat label="Players selected" value={`${selectedPlayers.length}/15`} />
              <SummaryStat label="Squad cost" value={`£${sumPrice(selectedPlayers).toFixed(1)}m`} />
              <SummaryStat label="Bank" value={`£${squad.bank.toFixed(1)}m`} />
              <SummaryStat label="Projected GW points" value={projections.totalPoints.toFixed(1)} highlight />
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              {POSITION_ORDER.map((position) => (
                <PositionPill
                  key={position}
                  position={position}
                  count={countsByPosition[position] || 0}
                  limit={POSITION_LIMITS[position]}
                />
              ))}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <label className="rounded-xl border border-fpl-border bg-fpl-bg px-4 py-3">
                <span className="text-[10px] uppercase tracking-[0.22em] text-fpl-muted">Bank</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={squad.bank}
                  onChange={(e) => squad.setBank(Number(e.target.value) || 0)}
                  className="mt-2 w-full bg-transparent text-lg font-bold text-white outline-none"
                />
              </label>
              <label className="rounded-xl border border-fpl-border bg-fpl-bg px-4 py-3">
                <span className="text-[10px] uppercase tracking-[0.22em] text-fpl-muted">Free transfers</span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={1}
                  value={squad.freeTransfers}
                  onChange={(e) => squad.setFreeTransfers(Number(e.target.value) || 0)}
                  className="mt-2 w-full bg-transparent text-lg font-bold text-white outline-none"
                />
              </label>
              <label className="rounded-xl border border-fpl-border bg-fpl-bg px-4 py-3">
                <span className="text-[10px] uppercase tracking-[0.22em] text-fpl-muted">Active chip</span>
                <select
                  value={squad.activeChip}
                  onChange={(e) => squad.setActiveChip(e.target.value as ChipMode)}
                  className="mt-2 w-full bg-transparent text-lg font-bold text-white outline-none"
                >
                  {CHIP_OPTIONS.map((chip) => (
                    <option key={chip.value} value={chip.value} className="bg-fpl-card">
                      {chip.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(validation.squadMessages.length > 0 || validation.lineupMessages.length > 0) && (
              <div className="mt-4 space-y-2">
                {validation.squadMessages.map((message) => (
                  <div key={message} className="rounded-xl border border-yellow-500/25 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
                    {message}
                  </div>
                ))}
                {validation.lineupMessages.map((message) => (
                  <div key={message} className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {message}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-fpl-border bg-fpl-card p-4">
            <div className="flex flex-wrap gap-2">
              {["All", ...POSITION_ORDER].map((position) => (
                <button
                  key={position}
                  onClick={() => setPositionFilter(position)}
                  className={clsx(
                    "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                    positionFilter === position
                      ? "border-fpl-green bg-fpl-green text-black"
                      : "border-fpl-border text-fpl-muted hover:border-white hover:text-white"
                  )}
                >
                  {position}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by player, club, or position"
              className="mt-4 w-full rounded-xl border border-fpl-border bg-fpl-bg px-3 py-2 text-sm text-white placeholder:text-fpl-muted focus:border-fpl-green focus:outline-none"
            />

            {error && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <div className="mt-4">
              {loading ? (
                <div className="animate-pulse text-sm text-fpl-muted">Loading available players...</div>
              ) : filteredPlayers.length ? (
                <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                  {filteredPlayers.slice(0, 80).map((player) => (
                    <button
                      key={player.id}
                      onClick={() => addPlayer(player)}
                      className="w-full rounded-lg border border-fpl-border bg-fpl-bg px-3 py-2.5 text-left transition-colors hover:border-fpl-green/40 hover:bg-[#121212]"
                    >
                      <PlayerSummaryRow player={player} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-fpl-border bg-fpl-bg px-4 py-6 text-sm text-fpl-muted">
                  No players match this search right now.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-fpl-border bg-fpl-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">Starting XI and captaincy</h2>
                <p className="mt-1 text-sm text-fpl-muted">
                  Auto-picked to the best legal formation, with manual swaps available if you want to shape the lineup yourself.
                </p>
              </div>
              <button
                onClick={autopickLineup}
                className="rounded-xl border border-fpl-border bg-fpl-bg px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-fpl-green/40 hover:text-fpl-green"
              >
                Auto-pick XI
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {derived.lineup.length ? (
                POSITION_ORDER.map((position) =>
                  lineupByPosition[position].length ? (
                    <section key={position}>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-muted">
                          {position} ({lineupByPosition[position].length})
                        </h3>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {lineupByPosition[position].map((player) => (
                          <SelectedPlayerRow
                            key={player.id}
                            player={player}
                            captain={derived.captain?.id === player.id}
                            viceCaptain={derived.viceCaptain?.id === player.id}
                            onRemove={() => removePlayer(player.id)}
                            onToggleStarter={() => toggleStarter(player.id)}
                            onCaptain={() => squad.setCaptainId(player.id)}
                            onViceCaptain={() => squad.setViceCaptainId(player.id)}
                            starter
                            compact
                          />
                        ))}
                      </div>
                    </section>
                  ) : null
                )
              ) : (
                <EmptyState body="Fill your squad to see a legal starting XI." />
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-fpl-border bg-fpl-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">Bench order</h2>
                <p className="mt-1 text-sm text-fpl-muted">
                  Keep your goalkeeper first, then order the outfield subs for auto-sub priority.
                </p>
              </div>
              <span className="rounded-full border border-fpl-border bg-fpl-bg px-3 py-1 text-xs font-semibold text-fpl-muted">
                Bench Boost adds {projections.benchPoints.toFixed(1)} pts
              </span>
            </div>

            <div className="mt-5 space-y-2">
              {derived.benchOrder.length ? (
                derived.benchOrder.map((player, index) => (
                  <SelectedPlayerRow
                    key={player.id}
                    player={player}
                    onRemove={() => removePlayer(player.id)}
                    onToggleStarter={() => toggleStarter(player.id)}
                    onBenchUp={index > 0 ? () => moveBenchPlayer(player.id, -1) : undefined}
                    onBenchDown={index < derived.benchOrder.length - 1 ? () => moveBenchPlayer(player.id, 1) : undefined}
                    benchLabel={index === 0 ? "GK bench" : `Bench ${index}`}
                  />
                ))
              ) : (
                <EmptyState body="The remaining players will appear here as your bench." />
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function validateTeamState(
  selectedPlayers: SquadPlayer[],
  lineup: SquadPlayer[],
  benchOrder: SquadPlayer[],
  captain: SquadPlayer | null,
  viceCaptain: SquadPlayer | null
) {
  const squadMessages: string[] = [];
  const lineupMessages: string[] = [];
  if (selectedPlayers.length !== 15) {
    squadMessages.push("Your squad must contain exactly 15 players.");
  }
  const clubCounts = selectedPlayers.reduce<Record<string, number>>((acc, player) => {
    const key = player.team_id ? String(player.team_id) : player.team_short;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  if (Object.values(clubCounts).some((count) => count > 3)) {
    squadMessages.push("You can own a maximum of three players from one club.");
  }
  if (!isValidLineupPlayers(lineup)) {
    lineupMessages.push("Your starting XI must use a legal FPL formation.");
  }
  if (benchOrder[0] && benchOrder[0].position !== "GKP") {
    lineupMessages.push("Your first bench slot must be the backup goalkeeper.");
  }
  if (!captain || !lineup.some((player) => player.id === captain.id)) {
    lineupMessages.push("Captain must be chosen from your starting XI.");
  }
  if (!viceCaptain || !lineup.some((player) => player.id === viceCaptain.id)) {
    lineupMessages.push("Vice-captain must be chosen from your starting XI.");
  }
  if (captain && viceCaptain && captain.id === viceCaptain.id) {
    lineupMessages.push("Captain and vice-captain must be different players.");
  }
  return { squadMessages, lineupMessages };
}

function sumPrice(players: SquadPlayer[]) {
  return players.reduce((sum, player) => sum + player.price, 0);
}

function PlayerSummaryRow({ player }: { player: SquadPlayer }) {
  return (
    <div className="flex items-center gap-3">
      <span className={clsx("rounded border px-1.5 py-0.5 text-[10px] font-semibold", POS_COLORS[player.position])}>
        {player.position}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{player.name}</p>
        <p className="text-xs text-fpl-muted">
          {player.team_short} · £{player.price.toFixed(1)}m · {player.selected_by_percent.toFixed(1)}% owned
        </p>
      </div>
      <div className="text-right">
        <p className="font-bold text-fpl-green">{player.predicted_points.toFixed(1)}</p>
        <p className="text-[11px] text-fpl-muted">pred pts</p>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-fpl-border bg-fpl-bg px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.22em] text-fpl-muted">{label}</p>
      <p className={clsx("mt-2 text-lg font-bold", highlight ? "text-fpl-green" : "text-white")}>{value}</p>
    </div>
  );
}

function PositionPill({
  position,
  count,
  limit,
}: {
  position: string;
  count: number;
  limit: number;
}) {
  const isComplete = count === limit;
  return (
    <div
      className={clsx(
        "rounded-xl border px-3 py-2",
        isComplete ? "border-fpl-green/35 bg-fpl-green/10" : "border-fpl-border bg-fpl-bg"
      )}
    >
      <p className="text-[10px] uppercase tracking-[0.22em] text-fpl-muted">{position}</p>
      <p className={clsx("mt-1 text-sm font-semibold", isComplete ? "text-fpl-green" : "text-white")}>
        {count}/{limit}
      </p>
    </div>
  );
}

function SelectedPlayerRow({
  player,
  starter,
  captain,
  viceCaptain,
  benchLabel,
  onRemove,
  onToggleStarter,
  onCaptain,
  onViceCaptain,
  onBenchUp,
  onBenchDown,
  compact,
}: {
  player: SquadPlayer;
  starter?: boolean;
  captain?: boolean;
  viceCaptain?: boolean;
  benchLabel?: string;
  onRemove: () => void;
  onToggleStarter: () => void;
  onCaptain?: () => void;
  onViceCaptain?: () => void;
  onBenchUp?: () => void;
  onBenchDown?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={clsx("rounded-xl border border-fpl-border bg-fpl-bg", compact ? "px-3 py-3" : "px-4 py-3")}>
      <div className="flex items-start gap-3">
        <span className={clsx("rounded border px-1.5 py-0.5 text-[10px] font-semibold", POS_COLORS[player.position])}>
          {player.position}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx("truncate font-semibold text-white", compact ? "text-base" : "text-lg")}>{player.name}</span>
            {captain ? <Badge text="C" color="green" /> : null}
            {viceCaptain ? <Badge text="VC" color="blue" /> : null}
            {!starter && benchLabel ? <Badge text={benchLabel} color="gray" /> : null}
          </div>
          <p className="mt-1 text-xs text-fpl-muted">
            {player.team_short} · £{player.price.toFixed(1)}m · form {player.form}
          </p>
          <div className="mt-2">
            <FDRBadge
              fdr={player.next_fdr ?? 3}
              opponent={player.next_opponent ?? "UNK"}
              home={player.next_home ?? false}
            />
          </div>
        </div>
        <div className="text-right">
          <p className="font-bold text-fpl-green">{player.predicted_points.toFixed(1)}</p>
          <p className="text-[11px] text-fpl-muted">pred pts</p>
        </div>
      </div>

      <div className={clsx("flex flex-wrap gap-2", compact ? "mt-2" : "mt-3")}>
        <button
          onClick={onToggleStarter}
          className="rounded-lg border border-fpl-border px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:border-fpl-green/40 hover:text-fpl-green"
        >
          {starter ? "Move to bench" : "Start player"}
        </button>
        {starter && onCaptain ? (
          <button
            onClick={onCaptain}
            className="rounded-lg border border-fpl-border px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:border-fpl-green/40 hover:text-fpl-green"
          >
            Captain
          </button>
        ) : null}
        {starter && onViceCaptain ? (
          <button
            onClick={onViceCaptain}
            className="rounded-lg border border-fpl-border px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:border-blue-400/40 hover:text-blue-300"
          >
            Vice-captain
          </button>
        ) : null}
        {!starter && onBenchUp ? (
          <button
            onClick={onBenchUp}
            className="rounded-lg border border-fpl-border px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:border-white/60"
          >
            Bench up
          </button>
        ) : null}
        {!starter && onBenchDown ? (
          <button
            onClick={onBenchDown}
            className="rounded-lg border border-fpl-border px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:border-white/60"
          >
            Bench down
          </button>
        ) : null}
        <button
          onClick={onRemove}
          className="rounded-lg border border-fpl-border px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:border-red-500/40 hover:text-red-300"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: "green" | "blue" | "gray" }) {
  const classes =
    color === "green"
      ? "border-fpl-green/40 bg-fpl-green/10 text-fpl-green"
      : color === "blue"
        ? "border-blue-400/40 bg-blue-400/10 text-blue-300"
        : "border-fpl-border bg-white/5 text-fpl-muted";
  return (
    <span className={clsx("rounded-full border px-2 py-0.5 text-[10px] font-semibold", classes)}>
      {text}
    </span>
  );
}

function EmptyState({ body }: { body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-fpl-border bg-fpl-bg px-4 py-4 text-sm text-fpl-muted">
      {body}
    </div>
  );
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatSavedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "saved";
  return `saved ${date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
