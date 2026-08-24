"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import clsx from "clsx";
import FDRBadge from "@/components/FDRBadge";
import PredictionStatus from "@/components/PredictionStatus";
import { fetchJson } from "@/lib/api";
import { EMPTY_PREDICTION_METADATA } from "@/lib/prediction-fallback";
import {
  computeTransferCost,
  deriveTeamState,
  projectTeamPoints,
  POSITION_ORDER,
  type ChipMode,
  type FplPlayer,
} from "@/lib/fpl-rules";
import {
  derivePredictionGameweek,
  resolveServingMode,
  type PredictionMetadata,
} from "@/lib/prediction-meta";
import { useSavedSquad } from "@/lib/saved-squad";

type OptPlayer = FplPlayer & {
  position_id: number;
  form: number;
  confidence: string;
  target_gameweek?: number;
  prediction_timestamp?: string;
};

interface OptResult extends PredictionMetadata {
  status: string;
  total_cost: number;
  budget_remaining: number;
  total_predicted_points: number;
  transfer_count: number;
  paid_transfers: number;
  hit_cost: number;
  squad: OptPlayer[];
}

type TransferPair = {
  position: OptPlayer["position"];
  outgoing: OptPlayer | null;
  incoming: OptPlayer | null;
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

function playerLabel(player: OptPlayer) {
  return `${player.name} (${player.team_short}) - ${player.position} - #${player.id}`;
}

export default function OptimizePage() {
  const [players, setPlayers] = useState<OptPlayer[]>([]);
  const [metadata, setMetadata] = useState<PredictionMetadata>(EMPTY_PREDICTION_METADATA);
  const [playerLoading, setPlayerLoading] = useState(true);
  const [playerError, setPlayerError] = useState("");
  const [mustInclude, setMustInclude] = useState<OptPlayer[]>([]);
  const [mustExclude, setMustExclude] = useState<OptPlayer[]>([]);
  const [includeQuery, setIncludeQuery] = useState("");
  const [excludeQuery, setExcludeQuery] = useState("");
  const [result, setResult] = useState<OptResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [budget, setBudget] = useState(100);
  const [budgetTouched, setBudgetTouched] = useState(false);
  const squad = useSavedSquad();

  useEffect(() => {
    async function loadPlayers() {
      try {
        setPlayerError("");
        const data = await fetchJson<{ predictions?: OptPlayer[] } & PredictionMetadata>("/api/predict?limit=700");
        if (data.predictions?.length && data.serving_mode === "database") {
          setPlayers(data.predictions);
          setMetadata(data);
        } else {
          setPlayerError("The live API did not return current database-backed predictions. Wait for the weekly refresh to finish.");
        }
      } catch (e: any) {
        setPlayerError(
          e.message || "Unable to load live player suggestions right now."
        );
      } finally {
        setPlayerLoading(false);
      }
    }

    loadPlayers();
  }, []);

  const playerMap = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const savedSquad = useMemo(
    () =>
      squad.playerIds
        .map((playerId) => playerMap.get(playerId))
        .filter((player): player is OptPlayer => Boolean(player)),
    [playerMap, squad.playerIds]
  );
  const savedDerived = useMemo(() => deriveTeamState(squad, savedSquad), [savedSquad, squad]);
  const savedProjection = useMemo(() => projectTeamPoints(squad, savedSquad), [savedSquad, squad]);
  const savedSquadCost = savedSquad.reduce((sum, player) => sum + player.price, 0);
  const availableBudget = Number((savedSquadCost + squad.bank).toFixed(1));
  const hasFullSavedSquad = squad.playerIds.length === 15 && savedSquad.length === 15;

  useEffect(() => {
    if (!savedSquad.length || budgetTouched) return;
    setBudget(Math.max(80, Math.min(104, availableBudget)));
  }, [availableBudget, budgetTouched, savedSquad.length]);

  const playerOptions = useMemo(() => {
    return players.map((player) => ({
      ...player,
      label: playerLabel(player),
    }));
  }, [players]);

  async function optimize() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await fetchJson<OptResult>("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget,
          must_include: mustInclude.map((player) => player.id),
          must_exclude: mustExclude.map((player) => player.id),
          current_squad_player_ids: hasFullSavedSquad ? squad.playerIds : [],
          free_transfers: squad.freeTransfers,
          active_chip: squad.activeChip,
        }),
      });
      if (data.status === "infeasible") {
        throw new Error("No valid squad found with these constraints. Try relaxing them.");
      }
      setResult(data);
      setMetadata(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const optimizedState = useMemo(
    () =>
      result
        ? {
            ...squad,
            playerIds: result.squad.map((player) => player.id),
          }
        : null,
    [result, squad]
  );
  const optimizedDerived = useMemo(
    () => (result && optimizedState ? deriveTeamState(optimizedState, result.squad) : null),
    [optimizedState, result]
  );
  const optimizedProjection = useMemo(
    () => (result && optimizedState ? projectTeamPoints(optimizedState, result.squad) : null),
    [optimizedState, result]
  );

  const transferPlan = useMemo(() => {
    if (!result || !optimizedProjection || !hasFullSavedSquad) return null;

    const incoming = result.squad.filter((player) => !squad.playerIds.includes(player.id));
    const outgoing = savedSquad.filter(
      (player) => !result.squad.some((candidate) => candidate.id === player.id)
    );
    const pairedMoves = buildTransferPairs(outgoing, incoming);
    const transferCount = result.transfer_count;
    const hit = result.hit_cost ?? computeTransferCost(transferCount, squad.freeTransfers, squad.activeChip);
    const rawPointGain = optimizedProjection.totalPoints - savedProjection.totalPoints;

    return {
      pairedMoves,
      transferCount,
      paidTransfers: result.paid_transfers,
      hit,
      rawPointGain,
      netPointGain: rawPointGain - hit,
      costDelta: result.total_cost - savedSquadCost,
    };
  }, [hasFullSavedSquad, optimizedProjection, result, savedProjection.totalPoints, savedSquad, savedSquadCost, squad]);

  const targetGameweek = derivePredictionGameweek({ metadata, players });
  const servingMode = resolveServingMode(metadata);

  const byPosition = result
    ? (["GKP", "DEF", "MID", "FWD"] as const).reduce<Record<string, OptPlayer[]>>((acc, pos) => {
        acc[pos] = result.squad.filter((player) => player.position === pos);
        return acc;
      }, {})
    : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-green">Transfer-aware comparison</p>
        <h1 className="mt-2 text-2xl font-extrabold text-white">Optimize a legal 15-player squad</h1>
        <p className="mt-1 max-w-3xl text-sm text-fpl-muted">
          The solver maximizes full-squad predicted points under budget, position, and club limits. With a complete saved squad, it subtracts four points for each transfer beyond your free allowance.
        </p>
      </div>

      <PredictionStatus
        mode={servingMode}
        gameweek={targetGameweek}
        generatedAt={metadata.generated_at ?? players[0]?.prediction_timestamp}
        provenance={metadata.prediction_provenance}
        modelVersion={metadata.model_version}
        isStale={metadata.is_stale}
        warning={metadata.serving_warning}
        compact
      />

      <section className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
        {!squad.hydrated ? (
          <div className="animate-pulse text-sm text-fpl-muted">Loading saved squad state…</div>
        ) : savedSquad.length ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-green">
                  Current FPL team state
                </p>
                <h2 className="mt-2 text-xl font-bold text-white">
                  Saved-squad transfer baseline
                </h2>
                <p className="mt-2 text-sm text-fpl-muted">
                  The optimizer uses your saved squad, approximate current prices plus bank, free transfers, and Wildcard/Free Hit hit rules. Bench Boost and Triple Captain affect the displayed projection, not squad selection.
                </p>
              </div>
              <Link
                href="/squad"
                className="rounded-xl border border-fpl-border bg-fpl-bg px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-fpl-green/40 hover:text-fpl-green"
              >
                Edit team setup
              </Link>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Current cost" value={`£${savedSquadCost.toFixed(1)}m`} />
              <Stat label="Bank" value={`£${squad.bank.toFixed(1)}m`} />
              <Stat label="Free transfers" value={String(squad.freeTransfers)} />
              <Stat label="Current projected points" value={savedProjection.totalPoints.toFixed(1)} highlight />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Available budget" value={`£${availableBudget.toFixed(1)}m`} />
              <Stat label="Active chip" value={prettyChip(squad.activeChip)} />
              <Stat label="Captain" value={savedDerived.captain?.name ?? "Not set"} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-yellow-300">
                No saved team yet
              </p>
              <h2 className="mt-2 text-xl font-bold text-white">
                Build your squad first to unlock transfer planning
              </h2>
              <p className="mt-2 text-sm text-fpl-muted">
                You can still run a generic best-squad search. Transfer counts and net-gain math only appear after all 15 saved players resolve against the prediction pool.
              </p>
            </div>
            <Link
              href="/squad"
              className="rounded-xl bg-fpl-green px-4 py-2.5 text-sm font-bold text-black transition-colors hover:bg-fpl-green-dim"
            >
              Go to My Squad
            </Link>
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <div className="rounded-xl border border-fpl-border bg-fpl-card p-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fpl-muted">
              Budget: £{budget}m
            </label>
            <input
              type="range"
              min={80}
              max={104}
              step={0.5}
              value={budget}
              onChange={(e) => {
                setBudgetTouched(true);
                setBudget(parseFloat(e.target.value));
              }}
              className="w-full accent-fpl-green"
            />
            <div className="mt-0.5 flex justify-between text-[10px] text-fpl-muted">
              <span>£80m</span>
              <span>{savedSquad.length && !budgetTouched ? "Defaults to squad cost + bank" : "Adjust to test scenarios"}</span>
              <span>£104m</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fpl-muted">
              Chip scenario
            </label>
            <select
              value={squad.activeChip}
              onChange={(e) => squad.setActiveChip(e.target.value as ChipMode)}
              className="w-full rounded-lg border border-fpl-border bg-fpl-bg px-3 py-2 text-sm text-white focus:border-fpl-green focus:outline-none"
            >
              {CHIP_OPTIONS.map((chip) => (
                <option key={chip.value} value={chip.value}>
                  {chip.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fpl-muted">
              Must Include
            </label>
            <PlayerPicker
              listId="include-player-options"
              query={includeQuery}
              onQueryChange={setIncludeQuery}
              onAdd={() =>
                addPlayer(includeQuery, setMustInclude, setMustExclude, playerOptions, setError, () =>
                  setIncludeQuery("")
                )
              }
              selected={mustInclude}
              onRemove={(playerId) => removePlayerFromList(playerId, setMustInclude)}
              options={playerOptions}
              placeholder="Search by player name, club, position, or ID"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fpl-muted">
              Must Exclude
            </label>
            <PlayerPicker
              listId="exclude-player-options"
              query={excludeQuery}
              onQueryChange={setExcludeQuery}
              onAdd={() =>
                addPlayer(excludeQuery, setMustExclude, setMustInclude, playerOptions, setError, () =>
                  setExcludeQuery("")
                )
              }
              selected={mustExclude}
              onRemove={(playerId) => removePlayerFromList(playerId, setMustExclude)}
              options={playerOptions}
              placeholder="Search by player name, club, position, or ID"
            />
          </div>

          {playerLoading ? (
            <div className="rounded-lg border border-fpl-border bg-fpl-bg px-3 py-2 text-sm text-fpl-muted">
              Loading the prediction pool…
            </div>
          ) : null}

          {playerError ? (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
              {playerError}
            </div>
          ) : null}

          <button
            onClick={optimize}
            disabled={loading || playerLoading}
            className="w-full rounded-lg bg-fpl-green py-2.5 text-sm font-bold text-black transition-colors hover:bg-fpl-green-dim disabled:opacity-40"
          >
            {loading ? "Optimizing..." : hasFullSavedSquad ? "Compare Against My Squad" : "Find Optimal Squad"}
          </button>
        </div>

        <div className="space-y-4">
          {error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          ) : null}

          {result && optimizedProjection && byPosition ? (
            <>
              <div className="flex flex-wrap gap-4 rounded-xl border border-fpl-border bg-fpl-card p-4">
                <Stat label="Optimized cost" value={`£${result.total_cost.toFixed(1)}m`} />
                <Stat label="Budget remaining" value={`£${result.budget_remaining.toFixed(1)}m`} />
                <Stat label="Raw projected points" value={optimizedProjection.totalPoints.toFixed(1)} highlight />
                <Stat
                  label={transferPlan ? "Net gain after hit" : "Selection objective"}
                  value={transferPlan ? formatSignedPoints(transferPlan.netPointGain) : `${result.total_predicted_points.toFixed(1)} squad pts`}
                />
              </div>

              {transferPlan ? (
                <section className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-green">
                        Transfer plan
                      </p>
                      <h2 className="mt-2 text-xl font-bold text-white">
                        Rule-aware move summary
                      </h2>
                      <p className="mt-2 text-sm text-fpl-muted">
                        Net gain = projected XI and captain gain − transfer hit. Wildcard and Free Hit remove the hit; other chips do not change the solver objective.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <Stat label="Transfers" value={String(transferPlan.transferCount)} />
                      <Stat label="Free / paid" value={`${squad.freeTransfers} / ${transferPlan.paidTransfers}`} />
                      <Stat label="Hit cost" value={`-${transferPlan.hit.toFixed(0)} pts`} />
                      <Stat label="Net gain" value={formatSignedPoints(transferPlan.netPointGain)} highlight={transferPlan.netPointGain >= 0} />
                    </div>
                  </div>

                  <div className="mt-4">
                    <Stat
                      label="Squad cost change"
                      value={`${transferPlan.costDelta >= 0 ? "+" : ""}£${transferPlan.costDelta.toFixed(1)}m`}
                    />
                  </div>

                  <TransferPairs
                    pairs={transferPlan.pairedMoves}
                    emptyMessage="The optimizer keeps every player from your current squad."
                  />
                </section>
              ) : null}

              <section className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
                <h2 className="text-xl font-bold text-white">Optimized squad</h2>
                <p className="mt-2 text-sm text-fpl-muted">
                  Selection uses all 15 players' predicted points under the legal squad constraints. The projected-points summary above separately derives a legal XI, captain, bench, and selected chip scenario.
                </p>
                <div className="mt-5 space-y-4">
                  {(["GKP", "DEF", "MID", "FWD"] as const).map((position) => (
                    <section key={position}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fpl-muted">
                        {position} ({byPosition[position]?.length})
                      </h3>
                      <div className="space-y-1.5">
                        {byPosition[position]?.map((player) => (
                          <div
                            key={player.id}
                            className="flex items-center gap-3 rounded-lg border border-fpl-border bg-fpl-bg px-4 py-2.5"
                          >
                            <span className={clsx("rounded border px-1.5 py-0.5 text-[10px] font-semibold", POS_COLORS[player.position])}>
                              {player.position}
                            </span>
                            <div className="min-w-0 flex-1">
                              <span className="font-semibold text-white">{player.name}</span>
                              <span className="ml-1.5 text-xs text-fpl-muted">{player.team_short}</span>
                            </div>
                            <span className="font-bold text-fpl-green">
                              {player.predicted_points.toFixed(1)} pts
                            </span>
                            <FDRBadge
                              fdr={player.next_fdr ?? 3}
                              opponent={player.next_opponent ?? "UNK"}
                              home={player.next_home ?? false}
                            />
                            <span className="w-14 text-right text-xs text-fpl-muted">£{player.price.toFixed(1)}m</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            </>
          ) : loading ? (
            <div className="animate-pulse rounded-xl border border-fpl-border bg-fpl-card px-5 py-10 text-center text-sm text-fpl-muted">
              Solving the constrained squad problem…
            </div>
          ) : error ? null : (
            <div className="rounded-xl border border-dashed border-fpl-border bg-fpl-card px-5 py-10 text-center">
              <p className="text-lg font-semibold text-white">No optimized squad yet</p>
              <p className="mx-auto mt-2 max-w-2xl text-sm text-fpl-muted">
                Run a generic legal-squad search, or save a complete team first to unlock transfer counts, hit costs, and net-gain comparison.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function addPlayer(
  query: string,
  setList: Dispatch<SetStateAction<OptPlayer[]>>,
  removeFromOtherList: Dispatch<SetStateAction<OptPlayer[]>>,
  options: Array<OptPlayer & { label: string }>,
  setError: (message: string) => void,
  clearQuery: () => void
) {
  const selected = options.find((player) => player.label === query.trim());
  if (!selected) {
    setError("Pick a player from the suggestions list.");
    return;
  }

  setError("");
  setList((current) => {
    if (current.some((player) => player.id === selected.id)) {
      return current;
    }
    return [...current, selected];
  });
  removeFromOtherList((current) => current.filter((player) => player.id !== selected.id));
  clearQuery();
}

function removePlayerFromList(
  playerId: number,
  setList: Dispatch<SetStateAction<OptPlayer[]>>
) {
  setList((current) => current.filter((player) => player.id !== playerId));
}

function PlayerPicker({
  listId,
  query,
  onQueryChange,
  onAdd,
  selected,
  onRemove,
  options,
  placeholder,
}: {
  listId: string;
  query: string;
  onQueryChange: (value: string) => void;
  onAdd: () => void;
  selected: OptPlayer[];
  onRemove: (playerId: number) => void;
  options: Array<OptPlayer & { label: string }>;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          list={listId}
          className="flex-1 rounded-lg border border-fpl-border bg-fpl-bg px-3 py-2 text-sm text-white placeholder:text-fpl-muted focus:border-fpl-green focus:outline-none"
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
        />
        <button
          type="button"
          onClick={onAdd}
          className="rounded-lg border border-fpl-green/40 px-3 py-2 text-sm font-semibold text-fpl-green transition-colors hover:bg-fpl-green/10"
        >
          Add
        </button>
      </div>
      <datalist id={listId}>
        {options.map((player) => (
          <option key={player.id} value={player.label} />
        ))}
      </datalist>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((player) => (
            <button
              key={player.id}
              type="button"
              onClick={() => onRemove(player.id)}
              className="inline-flex items-center gap-2 rounded-full border border-fpl-border bg-fpl-bg px-3 py-1 text-sm text-white hover:border-fpl-green/50"
            >
              <span>{player.name}</span>
              <span className="text-xs text-fpl-muted">{player.team_short}</span>
              <span className="text-xs text-fpl-green">×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TransferPairs({
  pairs,
  emptyMessage,
}: {
  pairs: TransferPair[];
  emptyMessage: string;
}) {
  const groupedPairs = POSITION_ORDER.reduce<Record<string, TransferPair[]>>((acc, position) => {
    acc[position] = pairs.filter((pair) => pair.position === position);
    return acc;
  }, {});

  return (
    <div className="mt-5 rounded-xl border border-fpl-border bg-fpl-bg p-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <p className="text-[10px] uppercase tracking-[0.22em] text-fpl-muted">Out</p>
        <p className="text-center text-[10px] uppercase tracking-[0.22em] text-fpl-muted">Swap</p>
        <p className="text-[10px] uppercase tracking-[0.22em] text-fpl-muted sm:text-right">In</p>
      </div>
      <div className="mt-3 space-y-4">
        {pairs.length ? (
          (POSITION_ORDER as readonly string[]).map((position) =>
            groupedPairs[position]?.length ? (
              <section key={position} className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fpl-green">
                  {position}
                </p>
                {groupedPairs[position].map((pair, index) => (
                  <div
                    key={`${position}-${pair.outgoing?.id ?? "none"}-${pair.incoming?.id ?? "none"}-${index}`}
                    className="grid gap-2 rounded-lg border border-fpl-border bg-fpl-card p-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center"
                  >
                    <TransferCard player={pair.outgoing} tone="out" />
                    <div className="flex items-center justify-center text-fpl-muted">
                      <span className="rounded-full border border-fpl-border px-2 py-1 text-xs font-semibold">
                        →
                      </span>
                    </div>
                    <TransferCard player={pair.incoming} tone="in" alignRight />
                  </div>
                ))}
              </section>
            ) : null
          )
        ) : (
          <p className="text-sm text-fpl-muted">{emptyMessage}</p>
        )}
      </div>
    </div>
  );
}

function TransferCard({
  player,
  tone,
  alignRight,
}: {
  player: OptPlayer | null;
  tone: "out" | "in";
  alignRight?: boolean;
}) {
  if (!player) {
    return (
      <div className={clsx("rounded-lg border border-dashed border-fpl-border px-3 py-2 text-sm text-fpl-muted", alignRight && "sm:text-right")}>
        No change
      </div>
    );
  }

  return (
    <div className={clsx("min-w-0", alignRight && "sm:text-right")}>
      <p className={clsx("truncate font-semibold", tone === "in" ? "text-fpl-green" : "text-white")}>
        {player.name}
      </p>
      <p className="text-xs text-fpl-muted">
        {player.team_short} · £{player.price.toFixed(1)}m · {player.predicted_points.toFixed(1)} pts
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-fpl-muted">{label}</p>
      <p className={clsx("text-lg font-bold", highlight ? "text-fpl-green" : "text-white")}>{value}</p>
    </div>
  );
}

function prettyChip(chip: ChipMode) {
  return chip
    .replace("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatSignedPoints(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} pts`;
}

function buildTransferPairs(outgoing: OptPlayer[], incoming: OptPlayer[]) {
  const outgoingByPosition = groupPlayersByPosition(outgoing, "out");
  const incomingByPosition = groupPlayersByPosition(incoming, "in");
  const pairs: TransferPair[] = [];

  for (const position of POSITION_ORDER) {
    const outgoingPlayers = outgoingByPosition[position] ?? [];
    const incomingPlayers = incomingByPosition[position] ?? [];
    const pairCount = Math.max(outgoingPlayers.length, incomingPlayers.length);

    for (let index = 0; index < pairCount; index += 1) {
      pairs.push({
        position,
        outgoing: outgoingPlayers[index] ?? null,
        incoming: incomingPlayers[index] ?? null,
      });
    }
  }

  return pairs;
}

function groupPlayersByPosition(players: OptPlayer[], direction: "out" | "in") {
  return POSITION_ORDER.reduce<Record<string, OptPlayer[]>>((acc, position) => {
    const ranked = players
      .filter((player) => player.position === position)
      .sort((a, b) =>
        direction === "out"
          ? (a.predicted_points || 0) - (b.predicted_points || 0)
          : (b.predicted_points || 0) - (a.predicted_points || 0)
      );
    acc[position] = ranked;
    return acc;
  }, {});
}
