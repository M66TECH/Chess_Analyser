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
  <div className="flex justify-between items-center bg-slate-800/50 px-3 py-1.5 rounded-lg text-xs">
    <span className={`${color} flex items-center gap-1.5`}>
      <span className="w-5 text-center font-bold font-mono">{icon}</span>
      <span>{label}</span>
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
  stats: {
    accuracy: number;
    acpl: number;
    inaccuracies: number;
    mistakes: number;
    blunders: number;
    brilliant?: number;
    great?: number;
    best?: number;
  };
}> = ({ name, swatchClass, stats }) => (
  <div className="space-y-3">
    <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
      <div className={`w-4 h-4 rounded-sm border ${swatchClass}`} />
      <span className="font-semibold text-sm">{name}</span>
    </div>

    <AccuracyCard label="Précision globale" value={stats.accuracy} />

    <div className="space-y-1.5">
      {stats.brilliant !== undefined && stats.brilliant > 0 && (
        <StatRow label="Coups Brillants" icon="!!" value={stats.brilliant} color="text-teal-300" />
      )}
      {stats.great !== undefined && stats.great > 0 && (
        <StatRow label="Grands Coups" icon="!" value={stats.great} color="text-blue-300" />
      )}
      {stats.best !== undefined && (
        <StatRow label="Meilleurs Coups" icon="★" value={stats.best} color="text-emerald-300" />
      )}
      <StatRow label="Imprécisions" icon="?!" value={stats.inaccuracies} color="text-yellow-300" />
      <StatRow label="Erreurs" icon="?" value={stats.mistakes} color="text-orange-400" />
      <StatRow label="Gaffes" icon="??" value={stats.blunders} color="text-red-400" />
    </div>

    <div className="flex justify-between items-center text-[11px] text-slate-400 px-1 pt-1">
      <span>Perte moyenne (ACPL)</span>
      <span className="font-bold text-slate-200 tabular-nums">{stats.acpl} cp</span>
    </div>
  </div>
);

/**
 * Rapport de match global (P3.16).
 *
 * Précision Lichess, phases de jeu, décompte détaillé des coups et tournant décisif.
 */
export const GameReport: React.FC<GameReportProps> = ({ stats, onClose }) => {
  if (!stats) return null;

  const hasBadges =
    stats.queensTraded !== undefined || stats.perfectDomination !== undefined;

  const countsW = stats.classificationCounts?.white;
  const countsB = stats.classificationCounts?.black;

  return (
    <div
      className="glass-panel rounded-2xl p-5 sm:p-6 text-slate-100 w-full max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar flex flex-col gap-4 shadow-2xl"
      role="dialog"
      aria-label="Rapport de partie"
    >
      <div className="flex justify-between items-center pb-2 border-b border-slate-700/60">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          <span aria-hidden="true">&#128202;</span> Bilan complet du match
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors text-base leading-none p-1 rounded hover:bg-slate-800"
            aria-label="Fermer le rapport"
            type="button"
          >
            &#10005;
          </button>
        )}
      </div>

      {/* Colonnes Joueurs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PlayerColumn
          name="Blancs"
          swatchClass="bg-slate-100 border-slate-300"
          stats={{
            accuracy: stats.accuracy.white,
            acpl: stats.acpl.white,
            inaccuracies: stats.inaccuracies.white,
            mistakes: stats.mistakes.white,
            blunders: stats.blunders.white,
            brilliant: countsW?.brilliant,
            great: countsW?.great,
            best: countsW?.best,
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
            brilliant: countsB?.brilliant,
            great: countsB?.great,
            best: countsB?.best,
          }}
        />
      </div>

      {/* Précision par phase de jeu */}
      {stats.phaseStats && (
        <div className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-3.5 flex flex-col gap-2 text-xs">
          <h3 className="font-bold text-slate-200 uppercase tracking-wider text-[11px] text-indigo-400">
            Précision par Phase
          </h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            {stats.phaseStats.opening && (
              <div className="bg-slate-800/50 p-2 rounded-lg">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Ouverture</div>
                <div className="font-bold text-slate-200 mt-0.5">
                  {stats.phaseStats.opening.white}% <span className="text-slate-500">/</span> {stats.phaseStats.opening.black}%
                </div>
              </div>
            )}
            {stats.phaseStats.middlegame && (
              <div className="bg-slate-800/50 p-2 rounded-lg">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Milieu</div>
                <div className="font-bold text-slate-200 mt-0.5">
                  {stats.phaseStats.middlegame.white}% <span className="text-slate-500">/</span> {stats.phaseStats.middlegame.black}%
                </div>
              </div>
            )}
            {stats.phaseStats.endgame && (
              <div className="bg-slate-800/50 p-2 rounded-lg">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Finale</div>
                <div className="font-bold text-slate-200 mt-0.5">
                  {stats.phaseStats.endgame.white}% <span className="text-slate-500">/</span> {stats.phaseStats.endgame.black}%
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tournant décisif du match */}
      {stats.criticalMoment && (
        <div className="bg-amber-950/20 border border-amber-500/40 rounded-xl p-3 text-xs flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-amber-300 font-bold uppercase tracking-wider text-[11px]">
            <span>&#9889;</span>
            <span>Tournant décisif du match</span>
          </div>
          <p className="text-slate-200">{stats.criticalMoment.description}</p>
        </div>
      )}

      {/* Enseignement clé pédagogique (Takeaway) */}
      {stats.takeaway && !stats.criticalMoment && (
        <div className="bg-indigo-950/20 border border-indigo-500/40 rounded-xl p-3 text-xs flex flex-col gap-1">
          <span className="text-indigo-300 font-bold uppercase tracking-wider text-[10px]">
            Bilan pédagogique
          </span>
          <p className="text-slate-200">{stats.takeaway}</p>
        </div>
      )}

      {hasBadges && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-700/50 text-[11px]">
          {stats.queensTraded && (
            <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
              Dames échangées
            </span>
          )}
          {stats.perfectDomination?.white && (
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              Domination parfaite (Blancs)
            </span>
          )}
          {stats.perfectDomination?.black && (
            <span className="px-2 py-0.5 rounded bg-slate-500/15 text-slate-300 border border-slate-500/30">
              Domination parfaite (Noirs)
            </span>
          )}
        </div>
      )}

      <p className="text-[10px] text-slate-500 leading-snug">
        Précision calculée avec l’algorithme officiel Lichess (volatilité + moyenne harmonique).
      </p>
    </div>
  );
};
