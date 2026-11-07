import clsx from "clsx";
import {
  formatPredictionDate,
  predictionProvenanceLabel,
  servingModeDetail,
  servingModeLabel,
  type PredictionProvenance,
  type ServingMode,
} from "@/lib/prediction-meta";

export default function PredictionStatus({
  mode,
  gameweek,
  generatedAt,
  provenance,
  modelVersion,
  isStale = false,
  warning,
  compact = false,
  unavailableLabel,
}: {
  mode: ServingMode;
  gameweek?: number | null;
  generatedAt?: string | null;
  provenance?: PredictionProvenance | string | null;
  modelVersion?: string | null;
  isStale?: boolean;
  warning?: string | null;
  compact?: boolean;
  unavailableLabel?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border",
        compact ? "px-3 py-2" : "px-4 py-3",
        mode === "database"
          ? "border-fpl-green/25 bg-fpl-green/10"
          : "border-yellow-500/30 bg-yellow-500/10"
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={clsx(
            "text-xs font-semibold uppercase tracking-[0.18em]",
            mode === "database" ? "text-fpl-green" : "text-yellow-200"
          )}
        >
          {mode === "unavailable" && unavailableLabel ? unavailableLabel : servingModeLabel(mode)}
        </span>
        {gameweek ? <span className="text-xs font-semibold text-white">Target GW {gameweek}</span> : null}
        {generatedAt ? (
          <span className="text-xs text-fpl-muted">Generated {formatPredictionDate(generatedAt)}</span>
        ) : null}
        <span className="text-xs text-fpl-muted">
          {predictionProvenanceLabel(provenance, modelVersion)}
        </span>
      </div>
      {warning ? (
        <p className={clsx("mt-1 text-xs", isStale ? "font-medium text-yellow-100" : "text-gray-300")}>
          {warning}
        </p>
      ) : !compact ? (
        <p className="mt-1 text-xs text-gray-300">{servingModeDetail(mode)}</p>
      ) : null}
    </div>
  );
}
