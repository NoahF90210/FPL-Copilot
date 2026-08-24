"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PredictionStatus from "@/components/PredictionStatus";
import { fetchJson } from "@/lib/api";
import { EMPTY_MODEL_STATUS } from "@/lib/prediction-fallback";
import {
  formatPredictionDate,
  resolveServingMode,
  type ModelStatus,
} from "@/lib/prediction-meta";

const FEATURES = [
  "Rolling points over the latest five appearances",
  "Rolling minutes over the latest five appearances",
  "Next-opponent fixture difficulty",
];

export default function AboutModelPage() {
  const [status, setStatus] = useState<ModelStatus>(EMPTY_MODEL_STATUS);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setNotice(null);
        setStatus(await fetchJson<ModelStatus>("/api/model-status"));
      } catch (err: any) {
        setNotice(
          err.message ||
            "Model status could not refresh. Live serving details will appear when the API is available."
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const evaluation = status.evaluation;
  const servingMode = resolveServingMode(null, status);

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-fpl-border bg-[radial-gradient(circle_at_top_left,_rgba(0,255,133,0.10),_transparent_28%),linear-gradient(135deg,_#161616_0%,_#101010_100%)] p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-fpl-green">Model card</p>
        <h1 className="mt-3 text-3xl font-extrabold text-white sm:text-4xl">
          Forecast next-gameweek player points, then expose the evidence.
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-gray-300 sm:text-base">
          FPL Copilot uses a compact Ridge regression to forecast next-gameweek player points from recent performance, minutes, and fixture difficulty.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/players" className="rounded-xl bg-fpl-green px-4 py-2.5 text-sm font-bold text-black transition-colors hover:bg-fpl-green-dim">
            Inspect predictions
          </Link>
          <Link href="/" className="rounded-xl border border-fpl-border bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-fpl-green/40 hover:bg-fpl-green/10">
            Back to dashboard
          </Link>
        </div>
        <div className="mt-5">
          <PredictionStatus
            mode={servingMode}
            gameweek={status.target_gameweek ?? status.latest_prediction_gameweek}
            generatedAt={status.generated_at ?? status.latest_prediction_timestamp}
            provenance={status.prediction_provenance}
            modelVersion={status.model_version}
            isStale={status.is_stale}
            warning={status.serving_warning}
          />
        </div>
      </section>

      {notice ? (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
          {notice}
        </div>
      ) : loading ? (
        <div className="rounded-xl border border-fpl-border bg-fpl-card px-4 py-3 text-sm text-fpl-muted">
          Loading live model status…
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <MethodCard
          eyebrow="Prediction target"
          title="Next-gameweek FPL points"
          body="The scoring pipeline produces one forecast per available player for the next target gameweek. The historical training rows are fixture-level, so double-gameweek aggregation remains a known limitation."
        />
        <MethodCard
          eyebrow="Main model"
          title="Ridge regression"
          body="A regularized linear model turns the three inputs into a transparent next-gameweek forecast."
        />
        <MethodCard
          eyebrow="Baseline"
          title="Recent-points average"
          body="The model is compared with the average points from each player's latest five appearances."
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-green">Feature construction</p>
          <h2 className="mt-2 text-xl font-bold text-white">What the trained pipeline actually uses</h2>
          <p className="mt-2 text-sm text-fpl-muted">
            Rolling performance values are shifted before training so each row uses earlier appearances. Numeric features are imputed and scaled; position is one-hot encoded.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature} className="rounded-xl border border-fpl-border bg-fpl-bg px-4 py-3 text-sm text-gray-300">
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-green">Time-based validation</p>
          <h2 className="mt-2 text-xl font-bold text-white">Latest evaluation</h2>
          <p className="mt-2 text-sm text-fpl-muted">
            The pipeline holds out later gameweeks rather than randomly mixing future rows into training. MAE is the average absolute player-point error; RMSE penalizes larger misses more heavily. Lower is better.
          </p>

          <div className="mt-5 space-y-3">
            <MetricRow label="Ridge baseline" primary={formatMetric(evaluation?.baseline?.mae)} secondary={formatRmse(evaluation?.baseline?.rmse)} />
            <MetricRow label="Gradient boosting" primary={formatMetric(evaluation?.model?.mae)} secondary={formatRmse(evaluation?.model?.rmse)} highlight />
            <MetricRow
              label="Holdout gameweeks"
              primary={evaluation?.validation_gameweeks?.length ? evaluation.validation_gameweeks.join("–") : "Unavailable"}
              secondary={formatRows(evaluation?.training_rows, evaluation?.validation_rows)}
            />
          </div>
          <p className="mt-4 text-xs text-fpl-muted">Evaluation values come from the latest training run recorded by the live model service.</p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-green">Live serving status</p>
          <h2 className="mt-2 text-xl font-bold text-white">Current data, current forecast</h2>
          <div className="mt-5 space-y-3">
            <StatusRow label="Prediction gameweek" value={(status.target_gameweek ?? status.latest_prediction_gameweek) ? `GW ${status.target_gameweek ?? status.latest_prediction_gameweek}` : "Unavailable"} />
            <StatusRow label="Prediction generated" value={formatPredictionDate(status.generated_at ?? status.latest_prediction_timestamp)} />
            <StatusRow label="Model version" value={status.model_version ?? "Unavailable"} />
            <StatusRow label="Database connection" value={friendlyDatabaseStatus(status.database_status)} />
          </div>
          <p className="mt-4 text-sm text-fpl-muted">
            Forecast rows come from the live Supabase database. The weekly refresh ingests official FPL data, retrains the model, and writes the next target gameweek back to the database.
          </p>
        </div>

        <div className="rounded-2xl border border-yellow-500/25 bg-yellow-500/5 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-yellow-200">Limitations</p>
          <h2 className="mt-2 text-xl font-bold text-white">What the evaluation does not prove</h2>
          <ul className="mt-4 space-y-3 text-sm text-gray-300">
            <li>Historical rows currently join current player price and ownership fields, creating a point-in-time leakage risk that should be removed before stronger accuracy claims.</li>
            <li>The holdout covers only five gameweeks and does not establish performance across seasons.</li>
            <li>Future injuries, late team news, rotation, tactical changes, blanks, and double-gameweek aggregation are not fully modeled.</li>
            <li>The metrics measure player-point error, not captain success, transfer uplift, overall rank, or guaranteed decision quality.</li>
            <li>The optimizer selects a legal 15-player squad and applies transfer-hit costs; it does not prove real-world FPL rank improvement.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function MethodCard({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-fpl-border bg-fpl-card p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fpl-muted">{eyebrow}</p>
      <h2 className="mt-3 text-xl font-bold text-white">{title}</h2>
      <p className="mt-2 text-sm text-gray-300">{body}</p>
    </div>
  );
}

function MetricRow({ label, primary, secondary, highlight }: { label: string; primary: string; secondary: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-fpl-border bg-fpl-bg px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="mt-1 text-xs text-fpl-muted">{secondary}</p>
      </div>
      <p className={`text-lg font-bold ${highlight ? "text-fpl-green" : "text-white"}`}>{primary}</p>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-fpl-border pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-fpl-muted">{label}</span>
      <span className="text-right text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

function friendlyDatabaseStatus(value?: string) {
  if (value === "connected") return "Connected";
  if (value === "unavailable" || value === "degraded") return "Unavailable; live data paused";
  return "Unknown";
}

function formatMetric(value?: number) {
  return value !== undefined ? `MAE ${value.toFixed(3)}` : "Unavailable";
}

function formatRmse(value?: number) {
  return value !== undefined ? `RMSE ${value.toFixed(3)}` : "RMSE unavailable";
}

function formatRows(training?: number, validation?: number) {
  if (training === undefined || validation === undefined) return "Row counts unavailable";
  return `${training.toLocaleString()} training rows · ${validation.toLocaleString()} validation rows`;
}
