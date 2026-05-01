"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PlayerCard from "@/components/PlayerCard";
import { fetchJson } from "@/lib/api";
import {
  deriveTeamState,
  projectTeamPoints,
  validateTeam,
  type FplPlayer,
} from "@/lib/fpl-rules";
import { mapSavedSquadPlayers, useSavedSquad } from "@/lib/saved-squad";

interface Player extends FplPlayer {
  id: number;
  name: string;
  full_name?: string;
  team?: string;
  team_id?: number;
  price: number;
  form: number;
  total_points: number;
  selected_by_percent: number;
  confidence: string;
  captain_score?: number;
  captain_reasoning?: string;
}

interface ModelStatus {
  latest_ingestion_run?: {
    completed_at?: string | null;
    status?: string;
    rows_inserted?: number;
  } | null;
  latest_training_run?: {
    completed_at?: string | null;
    status?: string;
    rows_inserted?: number;
  } | null;
  latest_prediction_timestamp?: string | null;
  latest_prediction_gameweek?: number | null;
  model_version?: string | null;
  evaluation?: {
    baseline?: { mae?: number; rmse?: number };
    model?: { mae?: number; rmse?: number };
    validation_gameweeks?: number[];
    training_rows?: number;
    validation_rows?: number;
  } | null;
  database_status?: string;
  database_error?: string | null;
}

export default function HomePage() {
  const [topPlayers, setTopPlayers] = useState<Player[]>([]);
  const [differentials, setDifferentials] = useState<Player[]>([]);
  const [captains, setCaptains] = useState<Player[]>([]);
  const [playerPool, setPlayerPool] = useState<Player[]>([]);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const squad = useSavedSquad();
  const { playerIds: savedPlayerIds, hydrated } = squad;

  useEffect(() => {
    async function load() {
      setError(null);
      try {
        const requests = [
          fetchJson<{ predictions?: Player[] }>("/api/predict?limit=12"),
          fetchJson<{ differentials?: Player[] }>("/api/differentials?limit=6"),
          fetchJson<{ captain_picks?: Player[] }>("/api/captain"),
          fetchJson<ModelStatus>("/api/model-status"),
          savedPlayerIds.length
            ? fetchJson<{ predictions?: Player[] }>("/api/predict?limit=700")
            : Promise.resolve({ predictions: [] as Player[] }),
        ] as const;

        const [predRes, diffRes, capRes, statusRes, poolRes] = await Promise.allSettled(requests);

        const failures = [predRes, diffRes, capRes, statusRes, poolRes].filter(
          (result) => result.status === "rejected"
        );

        if (predRes.status === "fulfilled") setTopPlayers(predRes.value.predictions || []);
        if (diffRes.status === "fulfilled") setDifferentials(diffRes.value.differentials || []);
        if (capRes.status === "fulfilled") setCaptains(capRes.value.captain_picks || []);
        if (statusRes.status === "fulfilled") setModelStatus(statusRes.value);
        if (poolRes.status === "fulfilled") setPlayerPool(poolRes.value.predictions || []);

        if (failures.length === requests.length) {
          setError(
            "Live recommendations are still warming up. Start the backend on port 8000, then refresh to unlock predictions."
          );
        } else if (failures.length > 0) {
          setError("Some live recommendations could not load, so this page is showing whatever was available.");
        }
      } catch {
        setError("The gameweek hub could not load live data right now.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [savedPlayerIds]);

  const topCaptain = captains[0];
  const bestDifferential = differentials[0];
  const fixtureTarget = useMemo(() => {
    if (!topPlayers.length) return null;
    return [...topPlayers].sort((a, b) => {
      const fdrDiff = (a.next_fdr ?? 99) - (b.next_fdr ?? 99);
      if (fdrDiff !== 0) return fdrDiff;
      return (b.predicted_points ?? 0) - (a.predicted_points ?? 0);
    })[0];
  }, [topPlayers]);

  const currentGameweek = modelStatus?.latest_prediction_gameweek;
  const savedSquad = useMemo(
    () => mapSavedSquadPlayers(savedPlayerIds, playerPool),
    [playerPool, savedPlayerIds]
  );
  const savedDerived = useMemo(() => deriveTeamState(squad, savedSquad), [savedSquad, squad]);
  const savedValidation = useMemo(() => validateTeam(squad, savedSquad), [savedSquad, squad]);
  const savedProjection = useMemo(() => projectTeamPoints(squad, savedSquad), [savedSquad, squad]);
  const savedSquadSummary = useMemo(
    () => buildSavedSquadSummary(savedSquad, savedDerived.lineup),
    [savedDerived.lineup, savedSquad]
  );

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[28px] border border-fpl-border bg-[radial-gradient(circle_at_top_left,_rgba(0,255,133,0.16),_transparent_32%),linear-gradient(135deg,_#161616_0%,_#101010_48%,_#0d0d0d_100%)] p-6 sm:p-8">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center rounded-full border border-fpl-green/25 bg-fpl-green/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-fpl-green">
              {currentGameweek ? `Gameweek ${currentGameweek} data science demo` : "Fantasy Premier League model demo"}
            </div>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              Know what to do this gameweek.
            </h1>
            <p className="mt-3 max-w-2xl text-base text-gray-300 sm:text-lg">
              A public demo of an end-to-end FPL data science project: weekly player projections, fixture-aware recommendations, and transfer planning powered by historical scoring data.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/squad"
                className="rounded-xl bg-fpl-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-fpl-green-dim"
              >
                Check My Squad
              </Link>
              <Link
                href="/players"
                className="rounded-xl border border-fpl-border bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-fpl-green/40 hover:bg-fpl-green/10"
              >
                Browse Players
              </Link>
            </div>
          </div>

          <div className="grid min-w-full gap-3 sm:grid-cols-3 lg:min-w-[420px] lg:max-w-[460px]">
            <HeroStat
              label="Top captain"
              value={topCaptain?.name ?? "Loading soon"}
              detail={
                topCaptain?.captain_score
                  ? `${topCaptain.captain_score.toFixed(1)} captain score`
                  : "Best armband play for this gameweek"
              }
            />
            <HeroStat
              label="Best differential"
              value={bestDifferential?.name ?? "Loading soon"}
              detail={
                bestDifferential?.selected_by_percent !== undefined
                  ? `${bestDifferential.selected_by_percent.toFixed(1)}% owned`
                  : "Low-owned upside play"
              }
            />
            <HeroStat
              label="Predictions"
              value={currentGameweek ? `GW ${currentGameweek}` : "Pending"}
              detail={formatRelativeTime(modelStatus?.latest_prediction_timestamp)}
            />
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
          {error}
        </div>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">This Week&apos;s Signals</h2>
            <p className="mt-1 text-sm text-fpl-muted">
              A quick read on the strongest moves before you dive into the full tools.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <RecommendationCard
            title="Captaincy edge"
            headline={topCaptain?.name ?? "No captain recommendation yet"}
            detail={
              topCaptain
                ? `${topCaptain.position} · ${topCaptain.team_short} · ${topCaptain.predicted_points.toFixed(1)} predicted pts`
                : "Start the backend to generate captain picks."
            }
            footnote={topCaptain?.captain_reasoning ?? "The best armband option will show up here once predictions are available."}
            accent="green"
          />
          <RecommendationCard
            title="Differential to watch"
            headline={bestDifferential?.name ?? "No differential recommendation yet"}
            detail={
              bestDifferential
                ? `${bestDifferential.predicted_points.toFixed(1)} predicted pts · ${bestDifferential.selected_by_percent.toFixed(1)}% owned`
                : "Low-owned upside plays appear here."
            }
            footnote={
              bestDifferential
                ? `${bestDifferential.team_short} ${formatFixtureLabel(bestDifferential)}`
                : "Useful for catching upside before ownership spikes."
            }
          />
          <RecommendationCard
            title="Fixture target"
            headline={fixtureTarget?.name ?? "No standout fixture yet"}
            detail={
              fixtureTarget
                ? `${formatFixtureLabel(fixtureTarget)} · FDR ${fixtureTarget.next_fdr}`
                : "Fixture-led opportunities will appear here."
            }
            footnote={
              fixtureTarget
                ? `${fixtureTarget.predicted_points.toFixed(1)} predicted pts with one of the softest fixtures on the board.`
                : "Great for transfer tie-breakers."
            }
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <ActionCard
          title="Analyze my squad"
          description="Build and save your squad once, then keep its projected points and structure available across the app."
          href="/squad"
          cta="Open My Squad"
        />
        <ActionCard
          title="Browse players"
          description="Filter the full player pool by predicted points, form, price, ownership, and fixture difficulty."
          href="/players"
          cta="Open Players"
        />
        <ActionCard
          title="Build optimal squad"
          description="Use the optimizer to compare your current squad against a transfer-aware plan that balances upside, budget, and points hits."
          href="/optimize"
          cta="Open Optimizer"
        />
      </section>

      <section className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-green">
              Your squad
            </p>
            <h2 className="mt-2 text-xl font-bold text-white">
              Saved squad insights for this gameweek
            </h2>
            <p className="mt-2 text-sm text-fpl-muted">
              Keep your current team in view while you decide whether to hold, captain, or optimize.
            </p>
          </div>
          <Link
            href={savedSquad.length ? "/optimize" : "/squad"}
            className="inline-flex items-center justify-center rounded-xl border border-fpl-border bg-fpl-bg px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-fpl-green/40 hover:text-fpl-green"
          >
            {savedSquad.length ? "Improve My Squad" : "Build My Squad"}
          </Link>
        </div>

        {hydrated && savedSquad.length && savedSquadSummary ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-4">
            <TrustStat
              label="Projected squad points"
              value={savedProjection.totalPoints.toFixed(1)}
              detail={`${savedSquad.length}/15 players saved`}
            />
            <TrustStat
              label="Best captain in squad"
              value={savedSquadSummary.captain.name}
              detail={`${savedSquadSummary.captain.predicted_points.toFixed(1)} predicted pts · ${formatFixtureLabel(savedSquadSummary.captain)}`}
            />
            <TrustStat
              label="Benching headache"
              value={savedSquadSummary.benchingDecision?.name ?? "Set your XI"}
              detail={
                savedSquadSummary.benchingDecision
                  ? `${savedSquadSummary.benchingDecision.predicted_points.toFixed(1)} predicted pts currently left out`
                  : "Pick a full starting XI to surface tough bench calls."
              }
            />
            <TrustStat
              label="Rule check"
              value={savedValidation.squadLegal && savedValidation.lineupLegal ? "Legal team" : "Needs attention"}
              detail={
                savedValidation.squadLegal && savedValidation.lineupLegal
                  ? `${savedSquadSummary.differential?.name ?? "No differential"} gives you low-owned upside.`
                  : [...savedValidation.squadMessages, ...savedValidation.lineupMessages][0]
              }
            />
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-fpl-border bg-fpl-bg px-5 py-8">
            <p className="text-lg font-semibold text-white">No saved squad insights yet</p>
            <p className="mt-2 max-w-2xl text-sm text-fpl-muted">
              Save your squad in My Squad and the dashboard will immediately show your projected total, best captain already owned, and where the weakest spot sits.
            </p>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">Top Predicted Players</h2>
            <p className="mt-1 text-sm text-fpl-muted">
              The highest projected options for the upcoming gameweek.
            </p>
          </div>
          <Link href="/players" className="text-sm font-semibold text-fpl-green hover:text-fpl-green-dim">
            See all players
          </Link>
        </div>

        {topPlayers.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {topPlayers.map((player, index) => (
              <PlayerCard
                key={player.id}
                player={player}
                highlight={index === 0}
                badge={
                  index === 0 ? (
                    <span className="rounded-full border border-fpl-green/40 bg-fpl-green/10 px-2 py-0.5 text-[10px] font-semibold text-fpl-green">
                      Best proj
                    </span>
                  ) : undefined
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Predicted player rankings will appear here"
            body="Once live predictions are available, this section becomes your fastest view of the best overall plays for the week."
          />
        )}
      </section>

      <section className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-fpl-green">Trust the output</p>
            <h2 className="mt-2 text-xl font-bold text-white">Fresh enough to act on, simple enough to trust.</h2>
            <p className="mt-2 text-sm text-gray-300">
              Based on historical FPL performance, recent form, and fixture context. This is a model-driven planning tool, not a guarantee of future points, and the technical details stay one click away.
            </p>
          </div>
          <Link
            href="/about-model"
            className="inline-flex items-center justify-center rounded-xl border border-fpl-border bg-fpl-bg px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-fpl-green/40 hover:text-fpl-green"
          >
            How predictions work
          </Link>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <TrustStat
            label="Predictions updated"
            value={formatRelativeTime(modelStatus?.latest_prediction_timestamp)}
            detail={
              currentGameweek
                ? `Ready for GW ${currentGameweek}`
                : modelStatus?.latest_prediction_timestamp
                  ? "Saved prediction snapshot available"
                  : "Waiting for the latest scoring run"
            }
          />
          <TrustStat
            label="Model version"
            value={modelStatus?.model_version ? compactModelName(modelStatus.model_version) : "Pending"}
            detail={modelStatus?.model_version ?? "Model metadata will appear here"}
          />
          <TrustStat
            label="Data freshness"
            value={friendlyDataStatus(modelStatus?.latest_ingestion_run?.status)}
            detail={buildFreshnessDetail(modelStatus)}
          />
          <TrustStat
            label="Coverage"
            value={buildCoverageValue(modelStatus)}
            detail="Historical FPL + fixture context"
          />
        </div>
      </section>
    </div>
  );
}

function HeroStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-fpl-muted">{label}</p>
      <p className="mt-2 text-lg font-bold text-white">{value}</p>
      <p className="mt-1 text-xs text-gray-400">{detail}</p>
    </div>
  );
}

function RecommendationCard({
  title,
  headline,
  detail,
  footnote,
  accent = "default",
}: {
  title: string;
  headline: string;
  detail: string;
  footnote: string;
  accent?: "default" | "green" | "amber";
}) {
  const accentClasses =
    accent === "green"
      ? "border-fpl-green/30 bg-[linear-gradient(160deg,_rgba(0,255,133,0.08),_rgba(22,22,22,1))]"
      : accent === "amber"
        ? "border-yellow-500/25 bg-[linear-gradient(160deg,_rgba(234,179,8,0.06),_rgba(22,22,22,1))]"
        : "border-fpl-border bg-fpl-card";

  return (
    <div className={`rounded-2xl border p-5 ${accentClasses}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-fpl-muted">{title}</p>
      <h3 className="mt-3 text-xl font-bold text-white">{headline}</h3>
      <p className="mt-2 text-sm text-gray-300">{detail}</p>
      <p className="mt-4 text-sm text-fpl-muted">{footnote}</p>
    </div>
  );
}

function ActionCard({
  title,
  description,
  href,
  cta,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-fpl-border bg-fpl-card p-5 transition-colors hover:border-fpl-green/35 hover:bg-[#1b1b1b]"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-muted">Quick action</p>
      <h2 className="mt-3 text-xl font-bold text-white">{title}</h2>
      <p className="mt-2 text-sm text-gray-300">{description}</p>
      <span className="mt-5 inline-flex text-sm font-semibold text-fpl-green transition-colors group-hover:text-fpl-green-dim">
        {cta}
      </span>
    </Link>
  );
}

function TrustStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-fpl-border bg-fpl-bg px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.22em] text-fpl-muted">{label}</p>
      <p className="mt-2 text-sm font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-fpl-muted">{detail}</p>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-fpl-border bg-fpl-card px-5 py-10 text-center">
      <p className="text-lg font-semibold text-white">{title}</p>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-fpl-muted">{body}</p>
    </div>
  );
}

function formatFixtureLabel(player: Player) {
  if (!player.next_opponent) return "Fixture pending";
  return `${player.next_home ? "vs" : "@"} ${player.next_opponent}`;
}

function compactModelName(modelVersion: string) {
  if (modelVersion.includes("hist_gradient")) return "Gradient Boosting";
  return modelVersion.replace(/_/g, " ");
}

function formatRelativeTime(value?: string | null) {
  if (!value) return "Pending";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function friendlyDataStatus(value?: string) {
  if (!value) return "Pending";
  if (value === "completed") return "Fresh";
  if (value === "snapshot_only") return "Saved snapshot";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildFreshnessDetail(modelStatus: ModelStatus | null) {
  const completedAt = modelStatus?.latest_ingestion_run?.completed_at;
  if (completedAt) return formatRelativeTime(completedAt);
  if (modelStatus?.latest_prediction_timestamp) {
    return `Saved predictions refreshed ${formatRelativeTime(modelStatus.latest_prediction_timestamp)}`;
  }
  return "Prediction metadata will appear here";
}

function buildCoverageValue(modelStatus: ModelStatus | null) {
  const rows = modelStatus?.latest_training_run?.rows_inserted;
  if (rows) return `${rows.toLocaleString()} rows`;
  if (modelStatus?.evaluation?.training_rows) {
    return `${modelStatus.evaluation.training_rows.toLocaleString()} train rows`;
  }
  return "Historical data";
}

function buildSavedSquadSummary(players: Player[], lineup: Player[]) {
  if (!players.length) return null;
  const sortedByPrediction = [...players].sort(
    (a, b) => (b.predicted_points || 0) - (a.predicted_points || 0)
  );
  const differentialCandidates = players
    .filter((player) => player.selected_by_percent <= 15)
    .sort((a, b) => (b.predicted_points || 0) - (a.predicted_points || 0));
  const benchingDecision = [...players]
    .filter((player) => !lineup.some((starter) => starter.id === player.id))
    .sort((a, b) => (b.predicted_points || 0) - (a.predicted_points || 0))[0];

  return {
    captain: sortedByPrediction[0],
    benchingDecision: benchingDecision ?? null,
    differential: differentialCandidates[0] ?? null,
  };
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-72 rounded-[28px] bg-fpl-card" />
      <div className="grid gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-48 rounded-2xl bg-fpl-card" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-44 rounded-2xl bg-fpl-card" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-40 rounded-2xl bg-fpl-card" />
        ))}
      </div>
    </div>
  );
}
