"use client";
import { useEffect, useState, useMemo } from "react";
import FDRBadge from "@/components/FDRBadge";
import PredictionStatus from "@/components/PredictionStatus";
import clsx from "clsx";
import { fetchJson } from "@/lib/api";
import { EMPTY_PREDICTION_METADATA } from "@/lib/prediction-fallback";
import {
  derivePredictionGameweek,
  resolveServingMode,
  type PredictionMetadata,
} from "@/lib/prediction-meta";

type SortKey =
  | "predicted_points"
  | "total_points"
  | "form"
  | "price"
  | "selected_by_percent"
  | "ict_index";

interface Player {
  id: number;
  name: string;
  full_name?: string;
  team?: string;
  team_short: string;
  position: string;
  price: number;
  form: number;
  total_points: number;
  selected_by_percent: number;
  predicted_points?: number;
  confidence?: string;
  target_gameweek?: number;
  prediction_timestamp?: string;
  next_fdr?: number;
  next_opponent?: string;
  next_home?: boolean;
  ict_index: number;
  minutes: number;
  status: string;
}

const POSITIONS = ["All", "GKP", "DEF", "MID", "FWD"];

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [metadata, setMetadata] = useState<PredictionMetadata>(EMPTY_PREDICTION_METADATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pos, setPos] = useState("All");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("predicted_points");
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    async function load() {
      setError("");
      try {
        // Single request: /api/players already joins predictions + hydration (same as /api/predict baseline).
        // Avoids loading and serializing ~700 players twice (major latency improvement).
        const pl = await fetchJson<{ players?: Player[] } & PredictionMetadata>(
          "/api/players?limit=700&sort_by=predicted_points"
        );
        if (pl.players?.length && pl.serving_mode === "database") {
          setPlayers(pl.players);
          setMetadata(pl);
        } else {
          setError("The live API did not return current database-backed player rows. Wait for the weekly refresh to finish.");
        }
      } catch (e: any) {
        setError(
          e.message || "Unable to load live player data right now."
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

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
      const av = (a as any)[sortKey] ?? 0;
      const bv = (b as any)[sortKey] ?? 0;
      return sortDesc ? bv - av : av - bv;
    });
    return data;
  }, [players, pos, search, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDesc((d) => !d);
    else { setSortKey(key); setSortDesc(true); }
  }

  const TH = ({ label, k }: { label: string; k: SortKey }) => (
    <th
      className="px-3 py-2 text-left text-xs font-semibold text-fpl-muted uppercase tracking-wide cursor-pointer hover:text-white select-none"
      onClick={() => toggleSort(k)}
    >
      {label} {sortKey === k ? (sortDesc ? "↓" : "↑") : ""}
    </th>
  );

  const POS_COLORS: Record<string, string> = {
    GKP: "text-yellow-400", DEF: "text-blue-400", MID: "text-fpl-green", FWD: "text-red-400",
  };
  const targetGameweek = derivePredictionGameweek({ metadata, players });
  const servingMode = resolveServingMode(metadata);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-green">Player research</p>
        <h1 className="mt-2 text-2xl font-extrabold text-white">Next-gameweek point forecasts</h1>
        <p className="mt-1 max-w-3xl text-sm text-fpl-muted">
          Sort the model target alongside form, price, ownership, ICT, minutes, and fixture difficulty. These fields provide evidence context; none guarantees future points.
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

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {POSITIONS.map((p) => (
          <button
            key={p}
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
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="rounded-lg border border-fpl-border bg-fpl-card px-4 py-3 text-sm text-fpl-muted">
          Loading live player data…
        </div>
      ) : null}

      {players.length === 0 ? (
        <div className="rounded-xl border border-dashed border-fpl-border bg-fpl-card px-5 py-8 text-center">
          <p className="text-lg font-semibold text-white">No prediction rows returned</p>
          <p className="mt-2 text-sm text-fpl-muted">The request succeeded, but there is no player pool to inspect.</p>
        </div>
      ) : (
        <>
          {error ? (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
              {error}
            </div>
          ) : null}
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
