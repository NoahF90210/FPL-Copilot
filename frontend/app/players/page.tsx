"use client";
import { useEffect, useState, useMemo } from "react";
import FDRBadge from "@/components/FDRBadge";
import PredictionStatus from "@/components/PredictionStatus";
import clsx from "clsx";
import { fetchJson } from "@/lib/api";
import { EMPTY_PREDICTION_METADATA } from "@/lib/prediction-fallback";
import bundledCatalogue from "@/data/player-catalogue.json";
import {
  forecastsAreCurrent,
  isPlayerCatalogue,
  withPlayerForecasts,
  type ForecastResponse,
  type PlayerCatalogue,
} from "@/lib/player-catalogue";
import {
  derivePredictionGameweek,
  formatPredictionDate,
  type ModelStatus,
} from "@/lib/prediction-meta";

type SortKey =
  | "predicted_points"
  | "total_points"
  | "form"
  | "price"
  | "selected_by_percent"
  | "ict_index";

const POSITIONS = ["All", "GKP", "DEF", "MID", "FWD"];

export default function PlayersPage() {
  const [catalogue, setCatalogue] = useState<PlayerCatalogue>(bundledCatalogue as PlayerCatalogue);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalogueError, setCatalogueError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [pos, setPos] = useState("All");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("predicted_points");
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    async function load() {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      // Never retain forecast advice through a failed refresh. Descriptive stats stay visible.
      setForecast(null);
      setCatalogue((previous) => ({ ...previous, source: "snapshot" }));
      setStatus(null);
      setError("");
      setCatalogueError("");
      setStatusError("");
      const init = { signal: controller.signal, cache: "no-store" as const };
      await Promise.allSettled([
        fetchJson<unknown>("/api/player-catalogue", init).then((data) => {
          if (!isPlayerCatalogue(data) || data.source !== "official_fpl") throw new Error("The official player stats response could not be validated.");
          if (active) setCatalogue(data);
        }).catch((e: unknown) => {
          if (active) {
            setCatalogue((previous) => ({ ...previous, source: "snapshot" }));
            setCatalogueError(errorMessage(e, "Official player stats could not refresh."));
          }
        }),
        fetchJson<ForecastResponse>("/api/players?limit=700&sort_by=predicted_points", init).then((data) => {
          if (!forecastsAreCurrent(data)) throw new Error("The API did not return a current, verified forecast batch.");
          if (active) setForecast(data);
        }).catch((e: unknown) => {
          if (active) setError(errorMessage(e, "The forecast request failed."));
        }),
        fetchJson<ModelStatus>("/api/model-status", init).then((data) => {
          if (active) setStatus(data);
        }).catch((e: unknown) => {
          if (active) setStatusError(errorMessage(e, "Refresh status could not be checked."));
        }),
      ]);
      inFlight = false;
      if (active) {
        setCheckedAt(new Date().toISOString());
        setLoading(false);
      }
    }
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [retry]);

  const players = useMemo(() => withPlayerForecasts(catalogue, forecast), [catalogue, forecast]);
  const hasForecasts = players.some((player) => player.predicted_points !== undefined);
  const metadata = hasForecasts && forecast ? forecast : EMPTY_PREDICTION_METADATA;

  const filtered = useMemo(() => {
    let data = players;
    if (pos !== "All") data = data.filter((p) => p.position === pos);
    if (search) {
      const q = normalizeSearch(search);
      data = data.filter(
        (p) => {
          const haystack = [
            p.name,
            p.full_name,
            p.team,
            p.team_short,
          ]
            .filter(Boolean)
            .map((value) => normalizeSearch(value as string))
            .join(" ");
          return haystack.includes(q);
        }
      );
    }
    data = [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === undefined) return bv === undefined ? 0 : 1;
      if (bv === undefined) return -1;
      return sortDesc ? bv - av : av - bv;
    });
    return data;
  }, [players, pos, search, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDesc((d) => !d);
    else { setSortKey(key); setSortDesc(true); }
  }

  const TH = ({ label, k }: { label: string; k: SortKey }) => (
    <th className="px-3 py-2 text-left text-xs font-semibold text-fpl-muted uppercase tracking-wide"
      aria-sort={sortKey === k ? (sortDesc ? "descending" : "ascending") : "none"}>
      <button type="button" className="hover:text-white focus-visible:outline focus-visible:outline-fpl-green" onClick={() => toggleSort(k)}>
        {label} {sortKey === k ? (sortDesc ? "↓" : "↑") : ""}
      </button>
    </th>
  );

  const POS_COLORS: Record<string, string> = {
    GKP: "text-yellow-400", DEF: "text-blue-400", MID: "text-fpl-green", FWD: "text-red-400",
  };
  const targetGameweek = derivePredictionGameweek({ metadata, players });
  const servingMode = hasForecasts ? "database" : "unavailable";
  const forecastWarning = catalogue.source === "snapshot"
    ? "Forecasts are hidden while showing a saved player snapshot. Saved stats are not current advice."
    : status?.forecast_unavailable_reason || error || "No matching verified forecasts are available for these players.";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-green">Player research</p>
        <h1 className="mt-2 text-2xl font-extrabold text-white">Players and next-gameweek forecasts</h1>
        <p className="mt-1 max-w-3xl text-sm text-fpl-muted">
          Browse official player stats even when forecasts are unavailable. Model points appear only when a current forecast matches the player’s identity and season.
        </p>
      </div>

      <section aria-label="Data availability" className="rounded-xl border border-fpl-border bg-fpl-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">{catalogue.source === "official_fpl" ? "Official FPL player stats" : "Saved player snapshot"} · {catalogue.season}</h2>
            <p className="mt-1 text-xs text-fpl-muted">{catalogue.total} players · Captured {formatSnapshotDate(catalogue.fetched_at)}</p>
          </div>
          <button type="button" disabled={loading} onClick={() => setRetry((value) => value + 1)}
            className="rounded-lg border border-fpl-border px-3 py-2 text-sm font-medium text-white hover:border-fpl-green focus-visible:outline focus-visible:outline-fpl-green disabled:opacity-50">
            {loading ? "Checking live data…" : "Retry live data"}
          </button>
        </div>
        {catalogue.source === "snapshot" ? (
          <p className="text-sm text-yellow-200">Not live: prices, form, ownership and availability may have changed. This dated snapshot contains no forecasts.</p>
        ) : null}
        {catalogueError ? <p role="alert" className="text-sm text-yellow-200">Stats refresh failed: {catalogueError} The saved stats remain available.</p> : null}
        {loading && !hasForecasts ? <p role="status" className="text-sm text-fpl-muted">Checking forecast availability. Player stats remain browsable.</p> : <PredictionStatus
        mode={servingMode}
        gameweek={targetGameweek}
        generatedAt={metadata.generated_at ?? players[0]?.prediction_timestamp}
        provenance={metadata.prediction_provenance}
        modelVersion={metadata.model_version}
        isStale={metadata.is_stale}
        warning={hasForecasts ? metadata.serving_warning : forecastWarning}
        unavailableLabel="Forecasts unavailable"
        compact
      />}
        {!loading && error ? <p role="alert" className="text-xs text-yellow-200">Forecast request failed: {error}</p> : null}
        {!hasForecasts && catalogue.source === "snapshot" && status?.forecast_unavailable_reason ? (
          <p className="text-xs text-yellow-200">Forecast verification: {status.forecast_unavailable_reason}</p>
        ) : null}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-fpl-muted">
          <span>Database: {status?.database_status ?? (loading ? "checking" : "status unavailable")}</span>
          <span>Ingestion: {status?.latest_ingestion_run?.status ?? "unknown"}{status?.latest_ingestion_run?.completed_at ? ` · ${formatPredictionDate(status.latest_ingestion_run.completed_at)}` : ""}</span>
          <span>Training: {status?.latest_training_run?.status ?? "unknown"}{status?.latest_training_run?.completed_at ? ` · ${formatPredictionDate(status.latest_training_run.completed_at)}` : ""}</span>
        </div>
        {statusError ? <p className="text-xs text-yellow-200">Refresh status unavailable: {statusError}</p> : null}
        <p className="text-xs text-fpl-muted">{checkedAt ? `Last checked ${formatPredictionDate(checkedAt)}. ` : ""}Retries every minute while this page is visible. <a href="/about-model" className="text-fpl-green underline">Model and refresh details</a></p>
      </section>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {POSITIONS.map((p) => (
          <button
            key={p}
            aria-pressed={pos === p}
            onClick={() => setPos(p)}
            className={clsx(
              "px-3 py-1 rounded-full text-sm font-medium border transition-colors",
              pos === p
                ? "bg-fpl-green border-fpl-green text-black"
                : "border-fpl-border text-fpl-muted hover:text-white hover:border-white"
            )}
          >
            {p}
          </button>
        ))}
        <input
          className="ml-auto bg-fpl-card border border-fpl-border rounded-lg px-3 py-1 text-sm text-white placeholder:text-fpl-muted focus:outline-none focus:border-fpl-green"
          placeholder="Search"
          aria-label="Search players or teams"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <p className="text-xs text-fpl-muted" role="status">{filtered.length} of {players.length} players · {hasForecasts ? "— means no verified forecast for this player." : "Forecasts unavailable; — is not a zero-point prediction."}</p>

      {players.length === 0 ? (
        <div className="rounded-xl border border-dashed border-fpl-border bg-fpl-card px-5 py-8 text-center">
          <p className="text-lg font-semibold text-white">Player stats are unavailable</p>
          <p className="mt-2 text-sm text-fpl-muted">{catalogueError || "No saved roster could be loaded. Retry live data."}</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-fpl-border">
          <table className="w-full text-sm">
            <thead className="bg-fpl-card border-b border-fpl-border">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-fpl-muted uppercase tracking-wide">Player</th>
                <TH label="Pred Pts" k="predicted_points" />
                <TH label="Form" k="form" />
                <TH label="Price" k="price" />
                <TH label="Pts" k="total_points" />
                <TH label="Own%" k="selected_by_percent" />
                <TH label="ICT" k="ict_index" />
                <th className="px-3 py-2 text-left text-xs font-semibold text-fpl-muted uppercase tracking-wide">Fixture</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-fpl-muted">
                    No players match the active position and search filters.
                  </td>
                </tr>
              ) : filtered.map((p, i) => (
                <tr
                  key={p.id}
                  className={clsx(
                    "border-b border-fpl-border/50 hover:bg-fpl-card/60 transition-colors",
                    i % 2 === 0 ? "bg-fpl-bg" : "bg-[#111]"
                  )}
                >
                  <td className="px-3 py-2">
                    <div className="font-semibold text-white">{p.name}</div>
                    <div className="text-[11px]">
                      <span className={clsx("font-medium", POS_COLORS[p.position])}>{p.position}</span>
                      {" · "}{p.team_short}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-bold text-fpl-green">
                      {p.predicted_points?.toFixed(1) ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium text-white">{p.form}</td>
                  <td className="px-3 py-2 text-white">£{p.price?.toFixed(1)}m</td>
                  <td className="px-3 py-2 text-white">{p.total_points}</td>
                  <td className="px-3 py-2 text-white">{p.selected_by_percent?.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-white">{p.ict_index?.toFixed(1)}</td>
                  <td className="px-3 py-2">
                    {p.next_fdr !== undefined ? (
                      <FDRBadge fdr={p.next_fdr} opponent={p.next_opponent} home={p.next_home} />
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatSnapshotDate(value: string) {
  return `${new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
}
