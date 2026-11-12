'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBullseye,
  faChartLine,
  faCrosshairs,
  faSliders,
  faRotate,
} from '@fortawesome/free-solid-svg-icons';

export interface ControlsRowProps {
  threatMode: boolean;
  showLines: boolean;
  onStartReview: () => void;
  onOpenReport: () => void;
  onToggleThreatMode: () => void;
  onToggleLines: () => void;
  onFlipBoard: () => void;
}

export function ControlsRow({
  threatMode,
  showLines,
  onStartReview,
  onOpenReport,
  onToggleThreatMode,
  onToggleLines,
  onFlipBoard,
}: ControlsRowProps) {
  return (
    <div className="flex gap-2 flex-wrap" role="toolbar" aria-label="Commandes de l'échiquier">
      <button
        onClick={onStartReview}
        className="flex-1 min-w-[100px] px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors shadow-lg flex items-center gap-2 justify-center text-white border border-indigo-400/30"
        title="Lancer la revue guidée de la partie"
      >
        <FontAwesomeIcon icon={faBullseye} className="w-3.5 h-3.5 text-white" />
        <span>Revue</span>
      </button>

      <button
        onClick={onOpenReport}
        className="flex-1 min-w-[100px] px-3 py-2 bg-slate-800/80 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-700/50 flex items-center gap-2 justify-center text-slate-200"
        title="Ouvrir le bilan complet de précision"
      >
        <FontAwesomeIcon icon={faChartLine} className="w-3.5 h-3.5 text-slate-300" />
        <span>Bilan</span>
      </button>

      <button
        onClick={onToggleThreatMode}
        className={`flex-1 min-w-[100px] px-3 py-2 rounded-lg text-sm font-medium transition-colors border flex items-center gap-2 justify-center ${
          threatMode
            ? 'bg-red-500/20 text-red-300 border-red-500/50'
            : 'hover:bg-slate-800/60 text-slate-300 border-slate-700/50'
        }`}
        title="Activer/désactiver l'affichage des menaces adverses"
        aria-pressed={threatMode}
      >
        <FontAwesomeIcon icon={faCrosshairs} className="w-3.5 h-3.5 text-red-400" />
        <span>Menaces</span>
      </button>

      <button
        onClick={onToggleLines}
        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors border flex items-center gap-1.5 justify-center ${
          showLines
            ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
            : 'bg-slate-800/70 hover:bg-slate-700 text-slate-300 border-slate-700/50'
        }`}
        title="Afficher les 3 meilleures variantes"
        aria-pressed={showLines}
      >
        <FontAwesomeIcon icon={faSliders} className="w-3.5 h-3.5 text-sky-400" />
        <span className="hidden sm:inline text-xs">Lignes</span>
      </button>

      <button
        onClick={onFlipBoard}
        className="px-3 py-2 bg-slate-800/70 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-700/50 text-slate-300 hover:text-white flex items-center justify-center"
        title="Retourner l'échiquier (F)"
        aria-label="Retourner l'échiquier"
      >
        <FontAwesomeIcon icon={faRotate} className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
