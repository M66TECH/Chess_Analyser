'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBullseye,
  faChartLine,
  faCrosshairs,
  faSliders,
  faRotate,
  faBackwardFast,
  faForwardFast,
  faChevronLeft,
  faChevronRight,
  faShareNodes,
} from '@fortawesome/free-solid-svg-icons';

export interface ControlsRowProps {
  threatMode: boolean;
  showLines: boolean;
  canPrev?: boolean;
  canNext?: boolean;
  onFirst?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onLast?: () => void;
  onStartReview: () => void;
  onOpenReport: () => void;
  onToggleThreatMode: () => void;
  onToggleLines: () => void;
  onFlipBoard: () => void;
  onShare?: () => void;
}

export function ControlsRow({
  threatMode,
  showLines,
  canPrev = true,
  canNext = true,
  onFirst,
  onPrev,
  onNext,
  onLast,
  onStartReview,
  onOpenReport,
  onToggleThreatMode,
  onToggleLines,
  onFlipBoard,
  onShare,
}: ControlsRowProps) {
  return (
    <div className="flex flex-col gap-2 w-full" role="toolbar" aria-label="Commandes de l'échiquier">
      {/* 1. Rangée de navigation pas-à-pas (tactile et souris) */}
      <div className="flex items-center justify-between gap-1.5 bg-slate-900/60 p-1.5 rounded-xl border border-slate-800">
        <div className="flex items-center gap-1 flex-1">
          <button
            type="button"
            onClick={onFirst}
            disabled={!canPrev}
            className="flex-1 py-1.5 px-2 bg-slate-800/80 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none rounded-lg text-slate-300 hover:text-white transition-colors flex items-center justify-center text-xs"
            title="Début de la partie (Flèche Haut)"
            aria-label="Premier coup"
          >
            <FontAwesomeIcon icon={faBackwardFast} className="text-xs" />
          </button>
          <button
            type="button"
            onClick={onPrev}
            disabled={!canPrev}
            className="flex-1 py-1.5 px-2 bg-slate-800/80 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none rounded-lg text-slate-300 hover:text-white transition-colors flex items-center justify-center text-xs"
            title="Coup précédent (Flèche Gauche)"
            aria-label="Coup précédent"
          >
            <FontAwesomeIcon icon={faChevronLeft} className="text-xs" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canNext}
            className="flex-1 py-1.5 px-2 bg-slate-800/80 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none rounded-lg text-slate-300 hover:text-white transition-colors flex items-center justify-center text-xs"
            title="Coup suivant (Flèche Droite)"
            aria-label="Coup suivant"
          >
            <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
          </button>
          <button
            type="button"
            onClick={onLast}
            disabled={!canNext}
            className="flex-1 py-1.5 px-2 bg-slate-800/80 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none rounded-lg text-slate-300 hover:text-white transition-colors flex items-center justify-center text-xs"
            title="Dernier coup (Flèche Bas)"
            aria-label="Dernier coup"
          >
            <FontAwesomeIcon icon={faForwardFast} className="text-xs" />
          </button>
        </div>

        <div className="flex items-center gap-1 border-l border-slate-800 pl-1.5">
          <button
            type="button"
            onClick={onFlipBoard}
            className="py-1.5 px-2.5 bg-slate-800/80 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors flex items-center justify-center text-xs"
            title="Retourner l'échiquier (Touche F)"
            aria-label="Retourner l'échiquier"
          >
            <FontAwesomeIcon icon={faRotate} className="text-xs" />
          </button>
          {onShare && (
            <button
              type="button"
              onClick={onShare}
              className="py-1.5 px-2.5 bg-slate-800/80 hover:bg-indigo-600/60 rounded-lg text-slate-300 hover:text-white transition-colors flex items-center justify-center text-xs"
              title="Copier le lien direct de la position (partage)"
              aria-label="Partager la position"
            >
              <FontAwesomeIcon icon={faShareNodes} className="text-xs" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Rangée des modes d'analyse et bilans */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={onStartReview}
          className="flex-1 min-w-[95px] px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors shadow-lg flex items-center gap-2 justify-center text-white border border-indigo-400/30"
          title="Lancer la revue guidée de la partie"
        >
          <FontAwesomeIcon icon={faBullseye} className="w-3.5 h-3.5 text-white" />
          <span>Revue</span>
        </button>

        <button
          onClick={onOpenReport}
          className="flex-1 min-w-[95px] px-3 py-2 bg-slate-800/80 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-700/50 flex items-center gap-2 justify-center text-slate-200"
          title="Ouvrir le bilan complet de précision"
        >
          <FontAwesomeIcon icon={faChartLine} className="w-3.5 h-3.5 text-slate-300" />
          <span>Bilan</span>
        </button>

        <button
          onClick={onToggleThreatMode}
          className={`flex-1 min-w-[95px] px-3 py-2 rounded-lg text-sm font-medium transition-colors border flex items-center gap-2 justify-center ${
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
      </div>
    </div>
  );
}
