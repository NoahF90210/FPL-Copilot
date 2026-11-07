export type ServingMode = "database" | "unavailable";
export type PredictionProvenance = "trained_model" | "unavailable";

export interface PredictionMetadata {
  target_gameweek?: number | null;
  generated_at?: string | null;
  serving_mode?: ServingMode | string;
  prediction_provenance?: PredictionProvenance | string;
  model_version?: string | null;
  is_stale?: boolean;
  serving_warning?: string | null;
}

export interface ModelStatus extends PredictionMetadata {
  forecast_unavailable_code?: string;
  forecast_unavailable_reason?: string;
  latest_ingestion_run?: {
    completed_at?: string | null;
    status?: string;
    rows_inserted?: number | null;
  } | null;
  latest_training_run?: {
    completed_at?: string | null;
    status?: string;
    rows_inserted?: number | null;
  } | null;
  latest_prediction_timestamp?: string | null;
  latest_prediction_gameweek?: number | null;
  evaluation?: {
    generated_at?: string;
    baseline?: { mae?: number; rmse?: number };
    model?: { mae?: number; rmse?: number };
    validation_gameweeks?: number[];
    training_rows?: number;
    validation_rows?: number;
  } | null;
  database_status?: string;
  prediction_serving_mode?: ServingMode | string;
}

export interface PredictionResponse<T> extends PredictionMetadata {
  predictions?: T[];
}

export function derivePredictionGameweek({
  metadata,
  status,
  players,
  fallbackGameweek,
}: {
  metadata?: PredictionMetadata | null;
  status?: ModelStatus | null;
  players?: Array<{ target_gameweek?: number | null }>;
  fallbackGameweek?: number | null;
}) {
  if (metadata?.target_gameweek) return metadata.target_gameweek;
  if (status?.target_gameweek) return status.target_gameweek;
  if (status?.latest_prediction_gameweek) return status.latest_prediction_gameweek;
  const playerGameweek = players?.find((player) => player.target_gameweek)?.target_gameweek;
  return playerGameweek ?? fallbackGameweek ?? null;
}

export function resolveServingMode(
  metadata?: PredictionMetadata | null,
  status?: ModelStatus | null,
  fallback: ServingMode = "unavailable"
): ServingMode {
  const value = metadata?.serving_mode ?? status?.serving_mode ?? status?.prediction_serving_mode;
  if (value === "database") {
    return value;
  }
  return value === "unavailable" || status?.database_status === "unavailable" ? "unavailable" : fallback;
}

export function servingModeLabel(mode: ServingMode) {
  if (mode === "database") return "Live model data";
  return "Live data unavailable";
}

export function servingModeDetail(mode: ServingMode) {
  if (mode === "database") return "Forecasts were loaded from the live application database.";
  return "The weekly FPL refresh has not produced live forecast rows yet.";
}

export function predictionProvenanceLabel(
  provenance?: PredictionProvenance | string | null,
  modelVersion?: string | null
) {
  const version = modelVersion ? modelVersion.replace(/_/g, " ") : null;
  if (provenance === "trained_model") return version ? `Trained model · ${version}` : "Trained model";
  return version ? `Provenance unavailable · ${version}` : "Provenance unavailable";
}

export function formatPredictionDate(value?: string | null) {
  if (!value) return "Date unavailable";
  const date = parsePredictionTimestamp(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatRelativeTime(value?: string | null) {
  if (!value) return "Date unavailable";
  const date = parsePredictionTimestamp(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return formatPredictionDate(value);

  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 14) return `${diffDays}d ago`;
  return formatPredictionDate(value);
}

function parsePredictionTimestamp(value: string) {
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasTimezone ? value : `${value}Z`);
}
