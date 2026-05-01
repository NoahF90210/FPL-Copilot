"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_TEAM_STATE,
  buildSavedTeamState,
  migrateLegacySnapshot,
  type ChipMode,
  type SavedTeamState,
} from "@/lib/fpl-rules";

const STORAGE_KEY = "fpl-copilot:saved-squad";

type SavedSquadContextValue = SavedTeamState & {
  hydrated: boolean;
  addPlayerId: (playerId: number) => void;
  removePlayerId: (playerId: number) => void;
  clearSquad: () => void;
  replaceSquad: (playerIds: number[]) => void;
  setLineupIds: (playerIds: number[]) => void;
  setBenchOrderIds: (playerIds: number[]) => void;
  setCaptainId: (playerId: number | null) => void;
  setViceCaptainId: (playerId: number | null) => void;
  setBank: (bank: number) => void;
  setFreeTransfers: (count: number) => void;
  setActiveChip: (chip: ChipMode) => void;
};

const SavedSquadContext = createContext<SavedSquadContextValue | null>(null);

function readSnapshot(): SavedTeamState {
  if (typeof window === "undefined") {
    return DEFAULT_TEAM_STATE;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TEAM_STATE;
    return migrateLegacySnapshot(JSON.parse(raw));
  } catch {
    return DEFAULT_TEAM_STATE;
  }
}

export function SavedSquadProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<SavedTeamState>(DEFAULT_TEAM_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSnapshot(readSnapshot());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }, [hydrated, snapshot]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function handleStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return;
      setSnapshot(readSnapshot());
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value = useMemo<SavedSquadContextValue>(
    () => ({
      ...snapshot,
      hydrated,
      addPlayerId: (playerId: number) => {
        setSnapshot((current) =>
          buildSavedTeamState({
            ...current,
            playerIds: [...current.playerIds, playerId],
          })
        );
      },
      removePlayerId: (playerId: number) => {
        setSnapshot((current) =>
          buildSavedTeamState({
            ...current,
            playerIds: current.playerIds.filter((id) => id !== playerId),
            lineupIds: current.lineupIds.filter((id) => id !== playerId),
            benchOrderIds: current.benchOrderIds.filter((id) => id !== playerId),
            captainId: current.captainId === playerId ? null : current.captainId,
            viceCaptainId:
              current.viceCaptainId === playerId ? null : current.viceCaptainId,
          })
        );
      },
      clearSquad: () => setSnapshot(DEFAULT_TEAM_STATE),
      replaceSquad: (playerIds: number[]) =>
        setSnapshot((current) =>
          buildSavedTeamState({
            ...current,
            playerIds,
          })
        ),
      setLineupIds: (playerIds: number[]) =>
        setSnapshot((current) =>
          buildSavedTeamState({
            ...current,
            lineupIds: playerIds,
          })
        ),
      setBenchOrderIds: (playerIds: number[]) =>
        setSnapshot((current) =>
          buildSavedTeamState({
            ...current,
            benchOrderIds: playerIds,
          })
        ),
      setCaptainId: (playerId: number | null) =>
        setSnapshot((current) =>
          buildSavedTeamState({
            ...current,
            captainId: playerId,
          })
        ),
      setViceCaptainId: (playerId: number | null) =>
        setSnapshot((current) =>
          buildSavedTeamState({
            ...current,
            viceCaptainId: playerId,
          })
        ),
      setBank: (bank: number) =>
        setSnapshot((current) =>
          buildSavedTeamState({
            ...current,
            bank,
          })
        ),
      setFreeTransfers: (count: number) =>
        setSnapshot((current) =>
          buildSavedTeamState({
            ...current,
            freeTransfers: count,
          })
        ),
      setActiveChip: (chip: ChipMode) =>
        setSnapshot((current) =>
          buildSavedTeamState({
            ...current,
            activeChip: chip,
          })
        ),
    }),
    [hydrated, snapshot]
  );

  return (
    <SavedSquadContext.Provider value={value}>
      {children}
    </SavedSquadContext.Provider>
  );
}

export function useSavedSquad() {
  const context = useContext(SavedSquadContext);
  if (!context) {
    throw new Error("useSavedSquad must be used within a SavedSquadProvider");
  }
  return context;
}

export function mapSavedSquadPlayers<T extends { id: number }>(
  playerIds: number[],
  players: T[]
) {
  const playerMap = new Map(players.map((player) => [player.id, player]));
  return playerIds
    .map((playerId) => playerMap.get(playerId))
    .filter((player): player is T => Boolean(player));
}
