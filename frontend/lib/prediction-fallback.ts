import type { ModelStatus, PredictionMetadata } from "@/lib/prediction-meta";

export const EMPTY_PREDICTION_METADATA: PredictionMetadata = {
  serving_mode: "unavailable",
  prediction_provenance: "unavailable",
  is_stale: false,
  serving_warning: "Live FPL data is unavailable while the weekly refresh is offline.",
};

export const EMPTY_MODEL_STATUS: ModelStatus = {
  ...EMPTY_PREDICTION_METADATA,
  prediction_serving_mode: "unavailable",
  database_status: "unavailable",
  evaluation: null,
};

export function emptyPredictionPlayers<T>() {
  return [] as T[];
}
