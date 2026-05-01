import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import { SavedSquadProvider } from "@/lib/saved-squad";

export const metadata: Metadata = {
  title: "FPL Copilot",
  description: "AI-powered Fantasy Premier League assistant",
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
