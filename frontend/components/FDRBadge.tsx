import clsx from "clsx";

interface FDRBadgeProps {
  fdr: number;
  opponent?: string;
  home?: boolean;
  className?: string;
}

export default function FDRBadge({ fdr, opponent, home, className }: FDRBadgeProps) {
  const level = Math.round(Math.max(1, Math.min(5, fdr)));
  return (
    <span
      className={clsx(
        `fdr-${level}`,
        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold",
        className
      )}
    >
      {opponent && (
        <>
          {opponent}
          {home !== undefined && (
            <span className="opacity-70 font-normal">({home ? "H" : "A"})</span>
          )}
        </>
      )}
      {!opponent && `FDR ${level}`}
    </span>
  );
}
