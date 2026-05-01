export type ChipMode =
  | "none"
  | "wildcard"
  | "free_hit"
  | "bench_boost"
  | "triple_captain";

export type FplPlayer = {
  id: number;
  name: string;
  team_short: string;
  team_id?: number;
  position: "GKP" | "DEF" | "MID" | "FWD";
  price: number;
  predicted_points: number;
  selected_by_percent: number;
  next_fdr?: number;
  next_opponent?: string;
  next_home?: boolean;
};

export type SavedTeamState = {
  playerIds: number[];
  lineupIds: number[];
  benchOrderIds: number[];
  captainId: number | null;
  viceCaptainId: number | null;
  bank: number;
  freeTransfers: number;
  activeChip: ChipMode;
  savedAt: string | null;
};

export type TeamValidation = {
  squadComplete: boolean;
  squadLegal: boolean;
  lineupLegal: boolean;
  squadMessages: string[];
  lineupMessages: string[];
};

export const POSITION_LIMITS = {
  GKP: 2,
  DEF: 5,
  MID: 5,
  FWD: 3,
} as const;

export const POSITION_ORDER = ["GKP", "DEF", "MID", "FWD"] as const;
export const VALID_FORMATIONS = [
  { DEF: 3, MID: 4, FWD: 3 },
  { DEF: 3, MID: 5, FWD: 2 },
  { DEF: 4, MID: 5, FWD: 1 },
  { DEF: 4, MID: 4, FWD: 2 },
  { DEF: 4, MID: 3, FWD: 3 },
  { DEF: 5, MID: 4, FWD: 1 },
  { DEF: 5, MID: 3, FWD: 2 },
  { DEF: 5, MID: 2, FWD: 3 },
] as const;

export const DEFAULT_TEAM_STATE: SavedTeamState = {
  playerIds: [],
  lineupIds: [],
  benchOrderIds: [],
  captainId: null,
  viceCaptainId: null,
  bank: 0,
  freeTransfers: 1,
  activeChip: "none",
  savedAt: null,
};

function uniqueIds(ids: number[]) {
  return Array.from(
    new Set(ids.filter((id) => Number.isInteger(id) && id > 0))
  );
}

function sortByPrediction<T extends Pick<FplPlayer, "predicted_points">>(players: T[]) {
  return [...players].sort(
    (a, b) => (b.predicted_points || 0) - (a.predicted_points || 0)
  );
}

export function sanitizeTeamState(
  value: Partial<SavedTeamState> | null | undefined
): SavedTeamState {
  const playerIds = uniqueIds(Array.isArray(value?.playerIds) ? value?.playerIds : []).slice(
    0,
    15
  );
  return {
    playerIds,
    lineupIds: uniqueIds(Array.isArray(value?.lineupIds) ? value?.lineupIds : []).slice(0, 11),
    benchOrderIds: uniqueIds(
      Array.isArray(value?.benchOrderIds) ? value?.benchOrderIds : []
    ).slice(0, 4),
    captainId:
      typeof value?.captainId === "number" && value.captainId > 0
        ? value.captainId
        : null,
    viceCaptainId:
      typeof value?.viceCaptainId === "number" && value.viceCaptainId > 0
        ? value.viceCaptainId
        : null,
    bank:
      typeof value?.bank === "number" && Number.isFinite(value.bank)
        ? Number(value.bank.toFixed(1))
        : 0,
    freeTransfers:
      typeof value?.freeTransfers === "number" && value.freeTransfers >= 0
        ? Math.min(5, Math.floor(value.freeTransfers))
        : 1,
    activeChip:
      value?.activeChip === "wildcard" ||
      value?.activeChip === "free_hit" ||
      value?.activeChip === "bench_boost" ||
      value?.activeChip === "triple_captain"
        ? value.activeChip
        : "none",
    savedAt: typeof value?.savedAt === "string" ? value.savedAt : null,
  };
}

export function migrateLegacySnapshot(value: any): SavedTeamState {
  if (value && Array.isArray(value.playerIds) && !("lineupIds" in value)) {
    return sanitizeTeamState({
      playerIds: value.playerIds,
      savedAt: typeof value.savedAt === "string" ? value.savedAt : null,
    });
  }
  return sanitizeTeamState(value);
}

export function buildSavedTeamState(
  next: Partial<SavedTeamState>
): SavedTeamState {
  const state = sanitizeTeamState({ ...DEFAULT_TEAM_STATE, ...next });
  return {
    ...state,
    savedAt: state.playerIds.length ? new Date().toISOString() : null,
  };
}

export function buildOptimalLineup<T extends FplPlayer>(players: T[]) {
  const goalkeepers = sortByPrediction(players.filter((player) => player.position === "GKP"));
  const defenders = sortByPrediction(players.filter((player) => player.position === "DEF"));
  const midfielders = sortByPrediction(players.filter((player) => player.position === "MID"));
  const forwards = sortByPrediction(players.filter((player) => player.position === "FWD"));

  let best: T[] = [];
  let bestScore = -1;

  for (const formation of VALID_FORMATIONS) {
    if (
      goalkeepers.length < 1 ||
      defenders.length < formation.DEF ||
      midfielders.length < formation.MID ||
      forwards.length < formation.FWD
    ) {
      continue;
    }

    const lineup = [
      goalkeepers[0],
      ...defenders.slice(0, formation.DEF),
      ...midfielders.slice(0, formation.MID),
      ...forwards.slice(0, formation.FWD),
    ];
    const score = lineup.reduce(
      (sum, player) => sum + (player.predicted_points || 0),
      0
    );
    if (score > bestScore) {
      best = lineup;
      bestScore = score;
    }
  }

  return sortByPrediction(best);
}

export function deriveTeamState<T extends FplPlayer>(
  state: SavedTeamState,
  players: T[]
) {
  const playerMap = new Map(players.map((player) => [player.id, player]));
  const selectedPlayers = state.playerIds
    .map((playerId) => playerMap.get(playerId))
    .filter((player): player is T => Boolean(player));

  const autoLineup = buildOptimalLineup(selectedPlayers);
  const requestedLineup = state.lineupIds
    .map((playerId) => playerMap.get(playerId))
    .filter((player): player is T => player !== undefined)
    .filter((player) => state.playerIds.includes(player.id));
  const lineup = requestedLineup.length === 11 ? requestedLineup : autoLineup;
  const lineupIds = new Set(lineup.map((player) => player.id));

  const benchPlayers = selectedPlayers.filter((player) => !lineupIds.has(player.id));
  const preferredBench = state.benchOrderIds
    .map((playerId) => playerMap.get(playerId))
    .filter((player): player is T => player !== undefined)
    .filter(
      (player) => state.playerIds.includes(player.id) && !lineupIds.has(player.id)
    );
  const benchGoalkeepers = sortByPrediction(
    benchPlayers.filter((player) => player.position === "GKP")
  );
  const benchOutfield = sortByPrediction(
    benchPlayers.filter((player) => player.position !== "GKP")
  );
  const defaultBench = [...benchGoalkeepers.slice(0, 1), ...benchOutfield].slice(0, 4);
  const remainingBench = defaultBench.filter(
    (player) => !preferredBench.some((preferred) => preferred.id === player.id)
  );
  const benchOrder = [...preferredBench, ...remainingBench].slice(0, 4);

  const captain =
    selectedPlayers.find((player) => player.id === state.captainId) || lineup[0] || null;
  const viceCaptain =
    selectedPlayers.find(
      (player) => player.id === state.viceCaptainId && player.id !== captain?.id
    ) ||
    lineup.find((player) => player.id !== captain?.id) ||
    null;

  return {
    selectedPlayers,
    lineup,
    benchOrder,
    captain,
    viceCaptain,
  };
}

export function validateTeam<T extends FplPlayer>(
  state: SavedTeamState,
  players: T[]
): TeamValidation {
  const { selectedPlayers, lineup, benchOrder, captain, viceCaptain } = deriveTeamState(
    state,
    players
  );

  const counts = POSITION_ORDER.reduce<Record<string, number>>((acc, position) => {
    acc[position] = selectedPlayers.filter((player) => player.position === position).length;
    return acc;
  }, {});
  const squadMessages: string[] = [];
  const lineupMessages: string[] = [];

  if (selectedPlayers.length !== 15) {
    squadMessages.push("Your squad must contain exactly 15 players.");
  }
  for (const position of POSITION_ORDER) {
    if (counts[position] !== POSITION_LIMITS[position]) {
      squadMessages.push(
        `${position} must total ${POSITION_LIMITS[position]}, and you currently have ${counts[position] || 0}.`
      );
    }
  }

  const clubCounts = selectedPlayers.reduce<Record<string, number>>((acc, player) => {
    const key = player.team_id ? String(player.team_id) : player.team_short;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const overClubLimit = Object.values(clubCounts).some((count) => count > 3);
  if (overClubLimit) {
    squadMessages.push("You can own a maximum of three players from one Premier League club.");
  }

  if (lineup.length !== 11) {
    lineupMessages.push("Your starting XI must contain exactly 11 players.");
  }
  const lineupCounts = POSITION_ORDER.reduce<Record<string, number>>((acc, position) => {
    acc[position] = lineup.filter((player) => player.position === position).length;
    return acc;
  }, {});
  const formationValid = isValidLineupPlayers(lineup);
  if (!formationValid) {
    lineupMessages.push("Your starting XI must use a valid FPL formation.");
  }
  if (benchOrder.length !== Math.min(4, selectedPlayers.length - lineup.length)) {
    lineupMessages.push("Your bench order must include one goalkeeper and three outfield players.");
  } else if (benchOrder[0]?.position !== "GKP") {
    lineupMessages.push("Your first bench slot should be your backup goalkeeper.");
  }
  if (!captain || !lineup.some((player) => player.id === captain.id)) {
    lineupMessages.push("Choose a captain from your starting XI.");
  }
  if (!viceCaptain || !lineup.some((player) => player.id === viceCaptain.id)) {
    lineupMessages.push("Choose a vice-captain from your starting XI.");
  }
  if (captain && viceCaptain && captain.id === viceCaptain.id) {
    lineupMessages.push("Captain and vice-captain must be different players.");
  }

  return {
    squadComplete: selectedPlayers.length === 15,
    squadLegal: squadMessages.length === 0,
    lineupLegal: lineupMessages.length === 0,
    squadMessages,
    lineupMessages,
  };
}

export function isValidLineupPlayers<T extends Pick<FplPlayer, "position">>(players: T[]) {
  if (players.length !== 11) return false;
  const counts = POSITION_ORDER.reduce<Record<string, number>>((acc, position) => {
    acc[position] = players.filter((player) => player.position === position).length;
    return acc;
  }, {});
  return VALID_FORMATIONS.some(
    (formation) =>
      counts.GKP === 1 &&
      counts.DEF === formation.DEF &&
      counts.MID === formation.MID &&
      counts.FWD === formation.FWD
  );
}

export function projectTeamPoints<T extends FplPlayer>(
  state: SavedTeamState,
  players: T[]
) {
  const { lineup, benchOrder, captain } = deriveTeamState(state, players);
  const lineupPoints = lineup.reduce(
    (sum, player) => sum + (player.predicted_points || 0),
    0
  );
  const benchPoints = benchOrder.reduce(
    (sum, player) => sum + (player.predicted_points || 0),
    0
  );
  const captainPoints = captain?.predicted_points || 0;
  const chipBoost =
    state.activeChip === "bench_boost"
      ? benchPoints
      : state.activeChip === "triple_captain"
        ? captainPoints * 2
        : captainPoints;

  return {
    lineupPoints,
    benchPoints,
    captainPoints,
    totalPoints: lineupPoints + chipBoost,
  };
}

export function countTransferChanges(currentIds: number[], nextIds: number[]) {
  const currentSet = new Set(currentIds);
  return nextIds.filter((id) => !currentSet.has(id)).length;
}

export function computeTransferCost(
  transferCount: number,
  freeTransfers: number,
  chip: ChipMode
) {
  if (chip === "wildcard" || chip === "free_hit") return 0;
  return Math.max(0, transferCount - freeTransfers) * 4;
}
