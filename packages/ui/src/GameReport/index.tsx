import React from 'react';
import type { GameStats } from '@chess-analyzer/chess-core';

export interface GameReportProps {
  stats: GameStats | null;
  onClose?: () => void;
}

const StatRow: React.FC<{ label: string; icon: string; value: number; color: string }> = ({
  label,
  icon,
  value,
  color,
}) => (
  <div className="flex justify-between items-center bg-slate-800/50 px-3 py-2 rounded-lg">
    <span className={`${color} flex items-center gap-2 text-sm`}>
      <span className="text-base w-5 text-center font-bold">{icon}</span> {label}
    </span>
    <span className="font-bold tabular-nums text-slate-100">{value}</span>
  </div>
);

const AccuracyCard: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="text-center bg-slate-800/60 p-3 rounded-lg border border-slate-700/50">
    <div className="text-xs text-slate-400 mb-1">{label}</div>
    <div className="text-3xl font-bold text-emerald-400 tabular-nums">{value}%</div>
  </div>
);

const PlayerColumn: React.FC<{
  name: string;
  swatchClass: string;
  stats: { accuracy: number; acpl: number; inaccuracies: number; mistakes: number; blunders: number };
}> = ({ name, swatchClass, stats }) => (
  <div className="space-y-3">
    <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
      <div className={`w-4 h-4 rounded-sm border ${swatchClass}`} />
      <span className="font-semibold">{name}</span>
    </div>

    <AccuracyCard label="Précision" value={stats.accuracy} />

    <div className="space-y-1.5">
      <StatRow label="Imprécisions" icon="?!" value={stats.inaccuracies} color="text-yellow-300" />
      <StatRow label="Erreurs" icon="?" value={stats.mistakes} color="text-orange-400" />
      <StatRow label="Gaffes" icon="??" value={stats.blunders} color="text-red-400" />
    </div>

    <div className="flex justify-between items-center text-xs text-slate-400 px-1 pt-1">
      <span>Perte moyenne (ACPL)</span>
      <span className="font-bold text-slate-200 tabular-nums">{stats.acpl} cp</span>
    </div>
  </div>
);

/**
 * Rapport de partie.
 *
 * `stats.accuracy` est calculé avec `AccuracyPercent.gameAccuracy` de Lichess
 * (pondération par volatilité + moyenne harmonique), pas avec une moyenne
 * arithmétique : le chiffre affiché correspond donc à celui de lichess.org.
 */
export const GameReport: React.FC<GameReportProps> = ({ stats, onClose }) => {
  if (!stats) return null;

  const hasBadges =
    stats.queensTraded !== undefined || stats.perfectDomination !== undefined;

  return (
    <div
      className="glass-panel rounded-2xl p-5 sm:p-6 text-slate-100 w-full max-w-md max-h-[85vh] overflow-y-auto custom-scrollbar"
      role="dialog"
      aria-label="Rapport de partie"
    >
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <span aria-hidden="true">&#128202;</span> Rapport de partie
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors text-lg leading-none"
            aria-label="Fermer le rapport"
            type="button"
          >
            &#10005;
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <PlayerColumn
          name="Blancs"
          swatchClass="bg-slate-100 border-slate-300"
          stats={{
            accuracy: stats.accuracy.white,
            acpl: stats.acpl.white,
            inaccuracies: stats.inaccuracies.white,
            mistakes: stats.mistakes.white,
            blunders: stats.blunders.white,
          }}
        />
        <PlayerColumn
          name="Noirs"
          swatchClass="bg-slate-900 border-slate-500"
          stats={{
            accuracy: stats.accuracy.black,
            acpl: stats.acpl.black,
            inaccuracies: stats.inaccuracies.black,
            mistakes: stats.mistakes.black,
            blunders: stats.blunders.black,
          }}
        />
      </div>

      {hasBadges && (
        <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-slate-700/50 text-xs">
          {stats.queensTraded && (
            <span className="px-2 py-1 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
              Dames échangées
            </span>
          )}
          {stats.perfectDomination?.white && (
            <span className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              Domination parfaite (Blancs)
            </span>
          )}
          {stats.perfectDomination?.black && (
            <span className="px-2 py-1 rounded bg-slate-500/15 text-slate-300 border border-slate-500/30">
              Domination parfaite (Noirs)
            </span>
          )}
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-500 leading-snug">
        Précision calculée avec la formule Lichess (volatilité + moyenne harmonique).
      </p>
    </div>
  );
};
