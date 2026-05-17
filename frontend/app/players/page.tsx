"use client";
import { useEffect, useState, useMemo } from "react";
import FDRBadge from "@/components/FDRBadge";
import clsx from "clsx";
import { fetchJson } from "@/lib/api";

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
        const pl = await fetchJson<{ players?: Player[] }>(
          "/api/players?limit=700&sort_by=predicted_points"
        );
        setPlayers(pl.players || []);
      } catch (e: any) {
        setPlayers([]);
        setError(e.message || "Unable to load player data right now. Try again shortly.");
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
  const CONF_COLORS: Record<string, string> = {
    high: "text-fpl-green", medium: "text-yellow-400", low: "text-red-400",
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Players</h1>
        <p className="text-fpl-muted text-sm mt-0.5">
          Browse the full prediction pool, compare model scores against form and ownership, and build shortlists for transfers or captaincy.
        </p>
      </div>

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
        <div className="text-fpl-muted animate-pulse">Loading players...</div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      ) : (
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
              {filtered.map((p, i) => (
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
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-fpl-green">
                        {p.predicted_points?.toFixed(1) ?? "—"}
                      </span>
                      {p.confidence && (
                        <span className={clsx("text-[10px] font-medium", CONF_COLORS[p.confidence])}>
                          {p.confidence}
                        </span>
                      )}
                    </div>
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
      )}
    </div>
  );
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
