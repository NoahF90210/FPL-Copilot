import clsx from "clsx";
import FDRBadge from "./FDRBadge";

interface Player {
  id: number;
  name: string;
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
  minutes?: number;
}

interface PlayerCardProps {
  player: Player;
  highlight?: boolean;
  badge?: React.ReactNode;
}

const POS_COLORS: Record<string, string> = {
  GKP: "text-yellow-400",
  DEF: "text-blue-400",
  MID: "text-fpl-green",
  FWD: "text-red-400",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "text-fpl-green",
  medium: "text-yellow-400",
  low: "text-red-400",
};

export default function PlayerCard({ player, highlight, badge }: PlayerCardProps) {
  return (
    <div
      className={clsx(
        "bg-fpl-card border rounded-lg p-4 flex flex-col gap-2 transition-colors",
        highlight ? "border-fpl-green" : "border-fpl-border",
        "hover:border-fpl-green/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{player.name}</p>
          <p className="text-xs text-fpl-muted">
            <span className={clsx("font-medium", POS_COLORS[player.position])}>
              {player.position}
            </span>{" "}
            · {player.team_short}
          </p>
        </div>
        {badge && <div>{badge}</div>}
      </div>

      {player.predicted_points !== undefined && (
        <div className="flex items-center gap-1">
          <span className="text-2xl font-extrabold text-fpl-green">
            {player.predicted_points.toFixed(1)}
          </span>
          <div className="flex flex-col">
            <span className="text-[10px] text-fpl-muted leading-none">pred</span>
            <span className="text-[10px] text-fpl-muted leading-none">pts</span>
          </div>
          {player.confidence && (
            <span
              className={clsx(
                "ml-auto text-[10px] font-medium uppercase tracking-wide",
                CONFIDENCE_COLORS[player.confidence]
              )}
            >
              {player.confidence}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1 text-xs">
        <Stat label="Form" value={player.form} />
        <Stat label="Price" value={`£${player.price.toFixed(1)}m`} />
        <Stat label="Own%" value={`${player.selected_by_percent}%`} />
      </div>

      {player.next_fdr !== undefined && (
        <FDRBadge
          fdr={player.next_fdr}
          opponent={player.next_opponent}
          home={player.next_home}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-fpl-muted text-[10px] uppercase tracking-wide">{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}
