"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PlayerCard from "@/components/PlayerCard";
import { fetchJson } from "@/lib/api";
import { EMPTY_PREDICTION_METADATA } from "@/lib/prediction-fallback";
import {
  deriveTeamState,
  projectTeamPoints,
  validateTeam,
  type FplPlayer,
} from "@/lib/fpl-rules";
import {
  derivePredictionGameweek,
  formatRelativeTime,
  type ModelStatus,
  type PredictionMetadata,
  type PredictionResponse,
} from "@/lib/prediction-meta";
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
  target_gameweek?: number;
}

const DASHBOARD_REFRESH_TIMEOUT_MS = 8000;

export default function HomePage() {
  const [topPlayers, setTopPlayers] = useState<Player[]>([]);
  const [playerPool, setPlayerPool] = useState<Player[]>([]);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [predictionMeta, setPredictionMeta] = useState<PredictionMetadata>(EMPTY_PREDICTION_METADATA);
  const [notice, setNotice] = useState<string | null>(null);
  const squad = useSavedSquad();
  const { playerIds: savedPlayerIds, hydrated } = squad;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setNotice(null);

      const coreRequests = [
        fetchDashboardJson<PredictionResponse<Player>>("/api/predict?limit=12"),
        fetchDashboardJson<ModelStatus>("/api/model-status"),
      ] as const;
      const poolRequest = savedPlayerIds.length
        ? fetchDashboardJson<PredictionResponse<Player>>("/api/predict?limit=700")
        : null;

      const [predRes, statusRes] = await Promise.allSettled(coreRequests);
      const poolRes = poolRequest ? await Promise.allSettled([poolRequest]).then(([result]) => result) : null;
      if (cancelled) return;

      const results = [predRes, statusRes, ...(poolRes ? [poolRes] : [])];
      const failureCount = results.filter((result) => result.status === "rejected").length;
      const successfulMetadata: PredictionMetadata[] = [];

      if (predRes.status === "fulfilled" && predRes.value.serving_mode === "database") {
        setTopPlayers(predRes.value.predictions ?? []);
        successfulMetadata.push(predRes.value);
      } else if (predRes.status === "fulfilled") {
        setTopPlayers([]);
      }
      if (statusRes.status === "fulfilled" && statusRes.value.prediction_serving_mode === "database") {
        setModelStatus(statusRes.value);
        successfulMetadata.push(statusRes.value);
      } else if (statusRes.status === "fulfilled") {
        setModelStatus(null);
      }
      if (poolRes?.status === "fulfilled" && poolRes.value.serving_mode === "database") {
        setPlayerPool(poolRes.value.predictions ?? []);
        successfulMetadata.push(poolRes.value);
      } else if (poolRes?.status === "fulfilled") {
        setPlayerPool([]);
      }

      const primaryMetadata = successfulMetadata.find((metadata) => metadata.serving_mode);
      if (primaryMetadata) setPredictionMeta(primaryMetadata);
      else setPredictionMeta(EMPTY_PREDICTION_METADATA);

      if (
        predRes.status === "rejected" ||
        statusRes.status === "rejected" ||
        (predRes.status === "fulfilled" && predRes.value.serving_mode !== "database")
      ) {
        setNotice("Live FPL data is unavailable. Resume Supabase or wait for the weekly refresh to finish.");
      } else if (failureCount > 0) {
        setNotice("The live player pool loaded, but one supporting request did not finish.");
      }
    }

    load().catch(() => {
      if (!cancelled) {
        setPredictionMeta(EMPTY_PREDICTION_METADATA);
        setNotice("Live FPL data is unavailable. Resume Supabase or wait for the weekly refresh to finish.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [savedPlayerIds]);

  const currentGameweek = derivePredictionGameweek({
    metadata: predictionMeta,
    status: modelStatus,
    players: topPlayers,
  });
  const generatedAt =
    predictionMeta.generated_at ?? modelStatus?.latest_prediction_timestamp;

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

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[28px] border border-fpl-border bg-[radial-gradient(circle_at_top_left,_rgba(0,255,133,0.16),_transparent_32%),linear-gradient(135deg,_#161616_0%,_#101010_48%,_#0d0d0d_100%)] p-6 sm:p-8">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center rounded-full border border-fpl-green/25 bg-fpl-green/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-fpl-green">
              {currentGameweek ? `Forecast target · GW ${currentGameweek}` : "Fantasy Premier League"}
            </div>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              Turn player forecasts into an FPL plan.
            </h1>
            <p className="mt-3 max-w-2xl text-base text-gray-300 sm:text-lg">
              Forecast next-gameweek points, compare fixture and ownership context, then test squad and transfer decisions under FPL constraints.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/squad"
                className="rounded-xl bg-fpl-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-fpl-green-dim"
              >
                Build My Squad
              </Link>
              <Link
                href="/players"
                className="rounded-xl border border-fpl-border bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-fpl-green/40 hover:bg-fpl-green/10"
              >
                Research Players
              </Link>
              <Link
                href="/about-model"
                className="rounded-xl border border-fpl-border bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-fpl-green/40 hover:bg-fpl-green/10"
              >
                Inspect the Model
              </Link>
            </div>
            <div className="mt-5 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs">
              <span className="font-semibold uppercase tracking-[0.18em] text-fpl-green">FPL Copilot</span>
              <span className="text-white">{currentGameweek ? `GW ${currentGameweek}` : "Live data unavailable"}</span>
              {generatedAt ? <span className="text-fpl-muted">Updated {formatRelativeTime(generatedAt)}</span> : null}
            </div>
          </div>

          <div className="min-w-full rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm lg:min-w-[420px] lg:max-w-[460px]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-fpl-muted">Next-gameweek leaders</p>
            <div className="mt-3 space-y-3">
              {topPlayers.slice(0, 3).map((player, index) => (
                <div key={player.id} className="flex items-center gap-3">
                  <span className="w-5 text-sm font-bold text-fpl-green">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-white">{player.name}</p>
                    <p className="text-xs text-fpl-muted">{player.position} · {player.team_short} · {formatFixtureLabel(player)}</p>
                  </div>
                  <p className="text-lg font-extrabold text-fpl-green">{player.predicted_points.toFixed(1)}</p>
                  <span className="text-[10px] uppercase tracking-wide text-fpl-muted">pts</span>
                </div>
              ))}
              {!topPlayers.length ? <p className="text-sm text-fpl-muted">Waiting for the live forecast run.</p> : null}
            </div>
          </div>
        </div>
      </section>

      {notice && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
          {notice}
        </div>
      )}

      <section className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-green">Plan under constraints</p>
            <h2 className="mt-2 text-xl font-bold text-white">Your legal squad, lineup, and transfer baseline</h2>
            <p className="mt-2 text-sm text-fpl-muted">
              Save 15 players, choose a legal XI and captain, then compare transfer moves after free transfers and points hits.
            </p>
          </div>
          <Link
            href={savedSquad.length ? "/optimize" : "/squad"}
            className="inline-flex items-center justify-center rounded-xl border border-fpl-border bg-fpl-bg px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-fpl-green/40 hover:text-fpl-green"
          >
            {savedSquad.length ? "Compare Transfers" : "Build My Squad"}
          </Link>
        </div>

        {!hydrated ? (
          <div className="mt-5 animate-pulse rounded-xl border border-fpl-border bg-fpl-bg px-5 py-8 text-sm text-fpl-muted">
            Loading saved squad state…
          </div>
        ) : savedPlayerIds.length > 0 && savedSquad.length === 0 ? (
          <div className="mt-5 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-5 py-6 text-sm text-yellow-100">
            Your saved player IDs are still stored, but the active prediction pool could not resolve them. Try again when player data is available.
          </div>
        ) : savedSquad.length && savedSquadSummary ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-4">
            <TrustStat label="Projected XI + captain" value={savedProjection.totalPoints.toFixed(1)} detail={`${savedSquad.length}/15 players resolved`} />
            <TrustStat
              label="Best captain in squad"
              value={savedSquadSummary.captain.name}
              detail={`${savedSquadSummary.captain.predicted_points.toFixed(1)} predicted pts · ${formatFixtureLabel(savedSquadSummary.captain)}`}
            />
            <TrustStat
              label="Benching decision"
              value={savedSquadSummary.benchingDecision?.name ?? "Set your XI"}
              detail={
                savedSquadSummary.benchingDecision
                  ? `${savedSquadSummary.benchingDecision.predicted_points.toFixed(1)} predicted pts outside the XI`
                  : "A full squad is needed to compare the bench."
              }
            />
            <TrustStat
              label="Rule check"
              value={savedValidation.squadLegal && savedValidation.lineupLegal ? "Legal team" : "Needs attention"}
              detail={
                savedValidation.squadLegal && savedValidation.lineupLegal
                  ? "Position, club, and formation constraints pass."
                  : [...savedValidation.squadMessages, ...savedValidation.lineupMessages][0]
              }
            />
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-fpl-border bg-fpl-bg px-5 py-8">
            <p className="text-lg font-semibold text-white">No saved squad yet</p>
            <p className="mt-2 max-w-2xl text-sm text-fpl-muted">
              Start in My Squad to construct a legal 15-player team and unlock lineup, captaincy, and transfer comparisons.
            </p>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-green">Start here</p>
            <h2 className="mt-2 text-xl font-bold text-white">The players projected to score most next week</h2>
            <p className="mt-1 text-sm text-fpl-muted">
              Use the ranking as the first pass, then open Players for deeper price, form, ownership, and fixture context.
            </p>
          </div>
          <Link href="/players" className="text-sm font-semibold text-fpl-green hover:text-fpl-green-dim">
            Open player research
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
                      Highest forecast
                    </span>
                  ) : undefined
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState title="Live forecast unavailable" body="The weekly refresh has not produced current player forecasts. Resume Supabase or wait for the scheduled model run." />
          )}
      </section>
    </div>
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

function fetchDashboardJson<T>(path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DASHBOARD_REFRESH_TIMEOUT_MS);
  return fetchJson<T>(path, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function formatFixtureLabel(player: Player) {
  if (!player.next_opponent) return "Fixture pending";
  return `${player.next_home ? "vs" : "@"} ${player.next_opponent}`;
}

function buildSavedSquadSummary(players: Player[], lineup: Player[]) {
  if (!players.length) return null;
  const sortedByPrediction = [...players].sort(
    (a, b) => (b.predicted_points || 0) - (a.predicted_points || 0)
  );
  const benchingDecision = [...players]
    .filter((player) => !lineup.some((starter) => starter.id === player.id))
    .sort((a, b) => (b.predicted_points || 0) - (a.predicted_points || 0))[0];

  return {
    captain: sortedByPrediction[0],
    benchingDecision: benchingDecision ?? null,
  };
}
