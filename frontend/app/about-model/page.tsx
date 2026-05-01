"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/api";

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
}

export default function AboutModelPage() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setError(null);
        setStatus(await fetchJson<ModelStatus>("/api/model-status"));
      } catch (err: any) {
        setError(err.message || "Unable to load model details right now.");
      }
    }

    load();
  }, []);

  const evaluation = status?.evaluation;

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-fpl-border bg-[radial-gradient(circle_at_top_left,_rgba(0,255,133,0.10),_transparent_28%),linear-gradient(135deg,_#161616_0%,_#101010_100%)] p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-fpl-green">How predictions work</p>
        <h1 className="mt-3 text-3xl font-extrabold text-white sm:text-4xl">The technical layer, without taking over the homepage.</h1>
        <p className="mt-3 max-w-3xl text-sm text-gray-300 sm:text-base">
          FPL Copilot blends historical FPL scoring, recent player form, and fixture context to generate weekly player projections. This page gives a recruiter-friendly view of the model inputs, evaluation snapshot, and data freshness without turning the whole app into a technical dashboard.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/"
            className="rounded-xl bg-fpl-green px-4 py-2.5 text-sm font-bold text-black transition-colors hover:bg-fpl-green-dim"
          >
            Back to Gameweek Hub
          </Link>
          <Link
            href="/players"
            className="rounded-xl border border-fpl-border bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-fpl-green/40 hover:bg-fpl-green/10"
          >
            See predictions
          </Link>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
          {error}
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        <InfoCard
          title="Inputs"
          body="Recent FPL performance, fixture difficulty, ownership, price, minutes, and rolling player form all help shape the weekly predictions."
        />
        <InfoCard
          title="Model flow"
          body="The app ingests FPL data, refreshes its warehouse tables, trains the latest model, and stores scored predictions for the recommendation and optimizer flows."
        />
        <InfoCard
          title="Why it matters"
          body="Predictions are most useful for tie-breakers: captaincy calls, shortlists, differentials, and budget-efficient squad construction."
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
          <h2 className="text-xl font-bold text-white">Model status</h2>
          <p className="mt-2 text-sm text-fpl-muted">
            A compact view of prediction freshness and whether you are looking at live storage or a saved snapshot.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <StatusTile
              label="Prediction gameweek"
              value={status?.latest_prediction_gameweek ? `GW ${status.latest_prediction_gameweek}` : "Pending"}
              detail={formatDate(status?.latest_prediction_timestamp)}
            />
            <StatusTile
              label="Model version"
              value={status?.model_version ? compactModelName(status.model_version) : "Pending"}
              detail={status?.model_version ?? "Waiting for training metadata"}
            />
            <StatusTile
              label="Last ingestion"
              value={friendlyStatus(status?.latest_ingestion_run?.status)}
              detail={formatDate(status?.latest_ingestion_run?.completed_at)}
            />
            <StatusTile
              label="Serving mode"
              value={friendlyStatus(status?.database_status)}
              detail={
                status?.database_status === "degraded"
                  ? "Using saved model outputs so the public demo stays reliable."
                  : "Live data path available."
              }
            />
          </div>
        </div>

        <div className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
          <h2 className="text-xl font-bold text-white">Evaluation snapshot</h2>
          <p className="mt-2 text-sm text-fpl-muted">
            Lower MAE and RMSE are better. These compare the baseline against the trained model on held-out gameweeks.
          </p>

          <div className="mt-5 space-y-3">
            <MetricRow
              label="Baseline MAE"
              primary={formatMetric(evaluation?.baseline?.mae)}
              secondary={formatSecondaryMetric(evaluation?.baseline?.rmse)}
            />
            <MetricRow
              label="Model MAE"
              primary={formatMetric(evaluation?.model?.mae)}
              secondary={formatSecondaryMetric(evaluation?.model?.rmse)}
              highlight
            />
            <MetricRow
              label="Validation gameweeks"
              primary={
                evaluation?.validation_gameweeks?.length
                  ? evaluation.validation_gameweeks.join(", ")
                  : "Pending"
              }
              secondary={`Train rows: ${evaluation?.training_rows ?? 0} · Validation rows: ${evaluation?.validation_rows ?? 0}`}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-muted">{title}</p>
      <p className="mt-3 text-sm text-gray-300">{body}</p>
    </div>
  );
}

function StatusTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-fpl-border bg-fpl-bg px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.22em] text-fpl-muted">{label}</p>
      <p className="mt-2 text-sm font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-fpl-muted">{detail}</p>
    </div>
  );
}

function MetricRow({
  label,
  primary,
  secondary,
  highlight,
}: {
  label: string;
  primary: string;
  secondary: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-fpl-border bg-fpl-bg px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="mt-1 text-xs text-fpl-muted">{secondary}</p>
      </div>
      <p className={`text-lg font-bold ${highlight ? "text-fpl-green" : "text-white"}`}>{primary}</p>
    </div>
  );
}

function compactModelName(modelVersion: string) {
  if (modelVersion.includes("hist_gradient")) return "Gradient Boosting";
  return modelVersion.replace(/_/g, " ");
}

function friendlyStatus(value?: string) {
  if (!value) return "Pending";
  if (value === "snapshot_only") return "Snapshot only";
  if (value === "degraded") return "Snapshot-backed demo";
  if (value === "healthy") return "Live database";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(value?: string | null) {
  if (!value) return "Not available yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMetric(value?: number) {
  return value !== undefined ? value.toFixed(3) : "Pending";
}

function formatSecondaryMetric(value?: number) {
  return value !== undefined ? `RMSE ${value.toFixed(3)}` : "RMSE pending";
}
