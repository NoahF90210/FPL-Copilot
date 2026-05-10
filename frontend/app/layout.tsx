import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import { SavedSquadProvider } from "@/lib/saved-squad";

export const metadata: Metadata = {
  title: "FPL Copilot",
  description:
    "Full-stack Fantasy Premier League analytics app with model-driven player projections, squad planning, and transfer-aware optimization.",
  metadataBase: new URL("https://fpl-copilot.tech"),
  openGraph: {
    title: "FPL Copilot",
    description:
      "Weekly FPL player projections, fixture-aware recommendations, and transfer planning in a deployed full-stack analytics app.",
    url: "https://fpl-copilot.tech",
    siteName: "FPL Copilot",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FPL Copilot",
    description:
      "Fantasy Premier League projections, squad analysis, and transfer-aware optimization.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-fpl-bg text-fpl-text">
        <SavedSquadProvider>
          <Navbar />
          <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
        </SavedSquadProvider>
      </body>
    </html>
  );
}
