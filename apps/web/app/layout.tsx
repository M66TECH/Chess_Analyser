import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ChessAnalyzer — Coach IA d'échecs avancé",
  description: "Analysez vos parties d'échecs avec Stockfish 16, détection de tactiques (fourchette, clouage), heatmap de pression, coach IA pédagogique. Dépassez votre niveau rapidement.",
  keywords: ["échecs", "analyse", "chess", "stockfish", "coach", "IA", "lichess", "chess.com"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="h-full overflow-hidden">
        {/* L14 — Error Boundary pour capturer les crashs de composants */}
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
