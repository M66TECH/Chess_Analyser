import React, { useState } from 'react';
import type { MoveRecord, MoveClassification } from '@chess-analyzer/chess-core';
import { classifyGamePhase, uciToSan } from '@chess-analyzer/chess-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChartLine,
  faXmark,
  faBullseye,
  faArrowLeft,
  faArrowRight,
} from '@fortawesome/free-solid-svg-icons';

export interface GameReviewModalProps {
  records: MoveRecord[];
  onSelectNode: (nodeId: string) => void;
  onStartRetry: (record: MoveRecord) => void;
  onClose: () => void;
}

const KEY_CLASSIFICATIONS: MoveClassification[] = ['blunder', 'mistake', 'brilliant', 'great'];

const MOMENT_BADGE: Partial<Record<MoveClassification, { label: string; icon: string; style: string }>> = {
  blunder: { label: 'Gaffe', icon: '??', style: 'bg-red-500/20 text-red-300 border-red-500/50' },
  mistake: { label: 'Erreur', icon: '?', style: 'bg-orange-500/20 text-orange-300 border-orange-500/50' },
  brilliant: { label: 'Coup Brillant', icon: '!!', style: 'bg-teal-500/20 text-teal-200 border-teal-500/50' },
  great: { label: 'Superbe Coup', icon: '!', style: 'bg-blue-500/20 text-blue-300 border-blue-500/50' },
};

export const GameReviewModal: React.FC<GameReviewModalProps> = ({
  records,
  onSelectNode,
  onStartRetry,
  onClose,
}) => {
  // Moments clés classés chronologiquement par coup
  const moments = records
    .filter((r) => KEY_CLASSIFICATIONS.includes(r.classification))
    .sort((a, b) => a.moveNumber - b.moveNumber);

  const [currentIndex, setCurrentIndex] = useState(0);

  if (moments.length === 0) {
    return (
      <div
        role="dialog"
        aria-label="Revue de partie"
        className="glass-panel rounded-2xl p-6 text-slate-100 w-full max-w-md shadow-2xl flex flex-col gap-4 text-center"
      >
        <h2 className="text-xl font-bold flex items-center justify-center gap-2">
          <FontAwesomeIcon icon={faChartLine} className="text-indigo-400 w-5 h-5" />
          <span>Revue de partie</span>
        </h2>
        <p className="text-sm text-slate-400">
          Aucun moment critique détecté pour le moment. Jouez plusieurs coups ou importez une partie complète pour démarrer la revue.
        </p>
        <button
          onClick={onClose}
          className="mt-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-semibold transition-colors"
        >
          Fermer
        </button>
      </div>
    );
  }

  const current = moments[currentIndex] ?? moments[0];
  const who = current.color === 'white' ? 'Blancs' : 'Noirs';
  const isNegative = current.classification === 'blunder' || current.classification === 'mistake';
  const badge = MOMENT_BADGE[current.classification] ?? MOMENT_BADGE.mistake!;
  const phaseInfo = classifyGamePhase({
    moveNumber: current.moveNumber,
    fen: current.fenBefore,
    inBook: current.theory?.inBook,
  });

  const bestSan = current.bestMove
    ? uciToSan(current.fenBefore, current.bestMove) ?? current.bestMove
    : 'Inconnu';

  const handlePrev = () => {
    if (currentIndex > 0) {
      const prevIdx = currentIndex - 1;
      setCurrentIndex(prevIdx);
      onSelectNode(moments[prevIdx].nodeId);
    }
  };

  const handleNext = () => {
    if (currentIndex < moments.length - 1) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      onSelectNode(moments[nextIdx].nodeId);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Revue guidée de partie"
      className="glass-panel rounded-2xl p-5 sm:p-6 text-slate-100 w-full max-w-lg shadow-2xl flex flex-col gap-4"
    >
      {/* En-tête */}
      <div className="flex justify-between items-center pb-2 border-b border-slate-700/60">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <FontAwesomeIcon icon={faChartLine} className="text-indigo-400 w-4 h-4" />
            <span>Revue guidée de partie</span>
          </h2>
          <span className="text-xs text-slate-400">
            Moment {currentIndex + 1} sur {moments.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-800 flex items-center justify-center"
          aria-label="Fermer la revue"
        >
          <FontAwesomeIcon icon={faXmark} className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Carte du moment clé */}
      <div className="bg-slate-900/70 border border-slate-700/50 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex justify-between items-start gap-2">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400 block mb-0.5">
              Phase : {phaseInfo.label}
            </span>
            <h3 className="text-base font-bold text-slate-100">
              Coup {Math.floor(current.moveNumber)} ({who}) :{' '}
              <span className="font-mono text-amber-300">{current.san}</span>
            </h3>
          </div>

          <span className={`text-xs px-2.5 py-1 rounded border font-bold uppercase ${badge.style}`}>
            {badge.icon} {badge.label}
          </span>
        </div>

        {/* Évolution de l'évaluation */}
        <div className="flex justify-between items-center text-xs bg-slate-800/60 px-3 py-2 rounded-lg">
          <span className="text-slate-400">Évaluation moteur</span>
          <span className="font-mono font-bold text-slate-200">
            {(current.cpBefore / 100).toFixed(1)} → {(current.cpAfter / 100).toFixed(1)}
          </span>
        </div>

        {isNegative && (
          <div className="text-xs text-slate-300 space-y-1">
            <p>
              Meilleur coup recommandé :{' '}
              <span className="font-bold text-emerald-400 font-mono">{bestSan}</span>
            </p>
            {current.coachCard?.headline && (
              <p className="text-slate-400 italic">« {current.coachCard.headline} »</p>
            )}
          </div>
        )}

        {!isNegative && (
          <p className="text-xs text-emerald-300">
            Un coup remarquable qui a fait basculer la position en votre faveur !
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5"
        >
          <FontAwesomeIcon icon={faArrowLeft} className="w-3 h-3" />
          <span>Précédent</span>
        </button>

        {isNegative && (
          <button
            onClick={() => {
              onStartRetry(current);
              onClose();
            }}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-colors flex items-center justify-center gap-1.5"
          >
            <FontAwesomeIcon icon={faBullseye} className="w-3.5 h-3.5" />
            <span>Retenter ce coup</span>
          </button>
        )}

        <button
          onClick={handleNext}
          disabled={currentIndex === moments.length - 1}
          className="ml-auto px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5"
        >
          <span>Suivant</span>
          <FontAwesomeIcon icon={faArrowRight} className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
