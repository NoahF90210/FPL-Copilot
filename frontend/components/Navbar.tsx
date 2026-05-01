"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/players", label: "Players" },
  { href: "/squad", label: "My Squad" },
  { href: "/optimize", label: "Optimizer" },
];

export default function Navbar() {
  const path = usePathname();

  return (
    <nav className="bg-fpl-card border-b border-fpl-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-6">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-fpl-green font-extrabold text-xl tracking-tight">FPL</span>
          <span className="font-semibold text-white">Copilot</span>
        </Link>
        <div className="flex items-center gap-1 overflow-x-auto">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={clsx(
                "px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors",
                path === l.href
                  ? "bg-fpl-green text-black"
                  : "text-fpl-muted hover:text-white hover:bg-fpl-border"
              )}
            >
              <span>{l.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
