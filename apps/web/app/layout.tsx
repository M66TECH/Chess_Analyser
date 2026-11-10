import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import "./globals.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Empêche FontAwesome d'injecter dynamiquement son CSS dans le DOM (recommandé SSR Next.js)
config.autoAddCss = false;

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
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      {/*
       * La page défile normalement (barre du navigateur) : `min-h-screen` plutôt
       * que `h-full`, et AUCUN `overflow-hidden` sur `body`.
       * L'ancien `h-full overflow-hidden` coupait toute la hauteur excédante —
       * le contenu des 3 colonnes (774 px) ne pouvait jamais défiler.
       */}
      <body className="min-h-screen">
        {/* L14 — Error Boundary pour capturer les crashs de composants */}
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
