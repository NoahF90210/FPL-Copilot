import type { PredictionMetadata } from "./prediction-meta";

export interface CataloguePlayer {
  id: number;
  player_code: number;
  name: string;
  full_name: string;
  team: string;
  team_short: string;
  position: string;
  price: number;
  form: number;
  total_points: number;
  selected_by_percent: number;
  ict_index: number;
  minutes: number;
  status: string;
}

export interface PlayerCatalogue {
  players: CataloguePlayer[];
  total: number;
  season: string;
  fetched_at: string;
  source: "official_fpl" | "snapshot";
  source_url: string;
}

export interface PlayerForecast extends CataloguePlayer {
  season: string;
  predicted_points?: number;
  target_gameweek?: number;
  prediction_timestamp?: string;
  next_fdr?: number;
  next_opponent?: string;
  next_home?: boolean;
}

export type ForecastResponse = PredictionMetadata & { players?: PlayerForecast[] };

export function isPlayerCatalogue(value: unknown): value is PlayerCatalogue {
  if (!value || typeof value !== "object") return false;
  const data = value as PlayerCatalogue;
  if (!/^\d{4}\/\d{2}$/.test(data.season) || !Number.isFinite(Date.parse(data.fetched_at)) ||
      !["official_fpl", "snapshot"].includes(data.source) ||
      !Array.isArray(data.players) || !data.players.length || data.total !== data.players.length) return false;
  const ids = new Set<number>();
  const codes = new Set<number>();
  return data.players.every((player) => {
    if (!player || !Number.isInteger(player.id) || player.id <= 0 || ids.has(player.id) ||
        !Number.isInteger(player.player_code) || player.player_code <= 0 || codes.has(player.player_code) ||
        !["GKP", "DEF", "MID", "FWD"].includes(player.position) ||
        ![player.name, player.full_name, player.team, player.team_short, player.status].every((v) => typeof v === "string" && v.length > 0) ||
        ![player.price, player.form, player.total_points, player.selected_by_percent, player.ict_index, player.minutes].every(Number.isFinite)) return false;
    ids.add(player.id);
    codes.add(player.player_code);
    return true;
  });
}

export function forecastsAreCurrent(response: ForecastResponse | null, now = Date.now()) {
  if (!response || response.serving_mode !== "database" || response.is_stale !== false ||
      !Array.isArray(response.players) || !response.players.length ||
      typeof response.generated_at !== "string" ||
      !Number.isInteger(response.target_gameweek) || !response.target_gameweek ||
      response.target_gameweek < 1 || response.target_gameweek > 38) return false;
  const ids = new Set<number>();
  if (!response.players.every((player) => {
    if (!player || !Number.isInteger(player.id) || player.id <= 0 || ids.has(player.id) ||
        !Number.isInteger(player.player_code) || player.player_code <= 0 ||
        ![player.name, player.full_name, player.team_short, player.status, player.season]
          .every((value) => typeof value === "string" && value.length > 0) ||
        !["GKP", "DEF", "MID", "FWD"].includes(player.position) ||
        player.target_gameweek !== response.target_gameweek ||
        typeof player.predicted_points !== "number" || !Number.isFinite(player.predicted_points) ||
        player.predicted_points < 0 ||
        (player.next_fdr !== undefined && (!Number.isFinite(player.next_fdr) || player.next_fdr < 1 || player.next_fdr > 5)) ||
        (player.next_opponent !== undefined && typeof player.next_opponent !== "string") ||
        (player.next_home !== undefined && typeof player.next_home !== "boolean")) return false;
    ids.add(player.id);
    return true;
  })) return false;
  const generatedAt = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(response.generated_at)
    ? response.generated_at : `${response.generated_at}Z`;
  const age = now - Date.parse(generatedAt);
  return Number.isFinite(age) && age >= -5 * 60_000 && age <= 36 * 60 * 60_000;
}

export function withPlayerForecasts(catalogue: PlayerCatalogue, response: ForecastResponse | null): PlayerForecast[] {
  const forecasts = new Map(
    (catalogue.source === "official_fpl" && forecastsAreCurrent(response) ? response?.players ?? [] : [])
      .map((player) => [player.id, player])
  );
  return catalogue.players.map((player) => {
    // Never join a reused FPL ID to a different person, season, team or position.
    const forecast = forecasts.get(player.id);
    const matches = forecast && forecast.player_code === player.player_code &&
      forecast.season === catalogue.season && forecast.full_name === player.full_name &&
      forecast.name === player.name && forecast.team_short === player.team_short &&
      forecast.position === player.position && forecast.status === player.status &&
      forecast.target_gameweek === response?.target_gameweek &&
      typeof forecast.predicted_points === "number" && Number.isFinite(forecast.predicted_points) &&
      forecast.predicted_points >= 0;
    return {
      ...player,
      season: catalogue.season,
      predicted_points: matches ? forecast.predicted_points : undefined,
      target_gameweek: matches ? forecast.target_gameweek : undefined,
      prediction_timestamp: matches ? forecast.prediction_timestamp : undefined,
      next_fdr: matches ? forecast.next_fdr : undefined,
      next_opponent: matches ? forecast.next_opponent : undefined,
      next_home: matches ? forecast.next_home : undefined,
    };
  });
}
