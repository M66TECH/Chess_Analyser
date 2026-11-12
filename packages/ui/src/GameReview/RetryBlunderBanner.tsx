import React, { useState } from 'react';
import type { MoveRecord } from '@chess-analyzer/chess-core';
import { classifyGamePhase, uciToSan, getProgressiveHints } from '@chess-analyzer/chess-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBullseye,
  faXmark,
  faTrophy,
  faTriangleExclamation,
  faLightbulb,
  faArrowRight,
} from '@fortawesome/free-solid-svg-icons';

export interface RetryBlunderBannerProps {
  blunderRecord: MoveRecord;
  status: 'idle' | 'success' | 'failed';
  isExactBest?: boolean;
  message?: string;
  revealed: boolean;
  onRevealSolution: () => void;
  onResetAttempt: () => void;
  onNextMoment?: () => void;
  onClose: () => void;
}

export const RetryBlunderBanner: React.FC<RetryBlunderBannerProps> = ({
  blunderRecord,
  status,
  isExactBest,
  message,
  revealed,
  onRevealSolution,
  onResetAttempt,
  onNextMoment,
  onClose,
}) => {
  const [hintLevel, setHintLevel] = useState<number>(0);
  const who = blunderRecord.color === 'white' ? 'Blancs' : 'Noirs';
  const phaseInfo = classifyGamePhase({
    moveNumber: blunderRecord.moveNumber,
    fen: blunderRecord.fenBefore,
    inBook: blunderRecord.theory?.inBook,
  });

  const bestSan = blunderRecord.bestMove
    ? uciToSan(blunderRecord.fenBefore, blunderRecord.bestMove) ?? blunderRecord.bestMove
    : 'inconnu';

  const hints = getProgressiveHints(blunderRecord);

  const handleNextHint = () => {
    const next = hintLevel + 1;
    setHintLevel(next);
    if (next >= 3) {
      onRevealSolution();
    }
  };

  const handleRevealAll = () => {
    setHintLevel(3);
    onRevealSolution();
  };

  const handleReset = () => {
    setHintLevel(0);
    onResetAttempt();
  };

  return (
    <div
      role="region"
      aria-label="Mode retenter la gaffe"
      className="w-full glass-panel border border-indigo-500/40 rounded-xl p-3 sm:p-4 text-slate-100 flex flex-col gap-2.5 shadow-xl transition-all"
    >
      <div className="flex justify-between items-center gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-amber-400 flex items-center gap-1.5">
            <FontAwesomeIcon icon={faBullseye} className="w-3.5 h-3.5" />
            <span>Mode Défi : Trouver le meilleur coup</span>
          </span>
          <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            {phaseInfo.label} · Coup {Math.floor(blunderRecord.moveNumber)}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors p-1.5 text-sm rounded-lg hover:bg-slate-800 flex items-center justify-center"
          title="Quitter le mode défi (Esc)"
          aria-label="Fermer le défi"
        >
          <FontAwesomeIcon icon={faXmark} className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-xs text-slate-300">
        Les <span className="font-semibold text-slate-200">{who}</span> ont joué{' '}
        <span className="font-mono font-bold text-red-400">{blunderRecord.san}</span>.
        Trouvez un coup plus fort directement sur le plateau !
      </p>

      {/* Résultat ou invitation */}
      <div
        role="status"
        aria-live="polite"
        className={`text-xs px-3 py-2 rounded-lg font-medium flex items-center justify-between gap-2 ${
          status === 'success'
            ? 'bg-emerald-950/60 border border-emerald-500/50 text-emerald-200'
            : status === 'failed'
            ? 'bg-orange-950/60 border border-orange-500/50 text-orange-200'
            : 'bg-slate-900/60 border border-slate-700/50 text-slate-300'
        }`}
      >
        <span className="flex items-center gap-1.5">
          {status === 'success' && <FontAwesomeIcon icon={faTrophy} className="text-amber-400 w-3.5 h-3.5" />}
          {status === 'failed' && <FontAwesomeIcon icon={faTriangleExclamation} className="text-orange-400 w-3.5 h-3.5" />}
          <span>
            {status === 'success'
              ? (message ?? (isExactBest ? 'Meilleur coup trouvé !' : 'Alternative excellente validée !'))
              : status === 'failed'
              ? (message ?? 'Ce coup reste insuffisant. Tentez une autre idée !')
              : 'Jouez une pièce sur l’échiquier pour tester votre solution.'}
          </span>
        </span>

        {status === 'failed' && (
          <button
            onClick={handleReset}
            className="text-[11px] underline hover:text-white shrink-0 font-semibold"
          >
            Réessayer
          </button>
        )}
      </div>

      {/* Indices progressifs (O18 / A31) */}
      {!revealed && status !== 'success' && hintLevel > 0 && (
        <div className="space-y-1.5 pt-0.5">
          {hintLevel >= 1 && (
            <div className="text-xs bg-slate-900/90 border border-indigo-500/30 rounded-lg px-3 py-1.5 text-indigo-300 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
              <span>{hints.hint1.text}</span>
            </div>
          )}
          {hintLevel >= 2 && (
            <div className="text-xs bg-slate-900/90 border border-amber-500/30 rounded-lg px-3 py-1.5 text-amber-300 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              <span>{hints.hint2.text}</span>
            </div>
          )}
        </div>
      )}

      {(revealed || hintLevel >= 3) && (
        <div className="text-xs bg-indigo-950/40 border border-indigo-500/30 rounded-lg p-2 text-indigo-200">
          Meilleur coup selon le moteur : <span className="font-bold font-mono text-emerald-300">{bestSan}</span>.
          La flèche verte est affichée sur l’échiquier.
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {!revealed && status !== 'success' && hintLevel < 3 && (
          <button
            onClick={handleNextHint}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-colors flex items-center gap-1.5"
            title="Dévoiler l'indice suivant sans révéler directement le coup"
          >
            <FontAwesomeIcon icon={faLightbulb} className="text-amber-400 w-3 h-3" />
            <span>
              {hintLevel === 0
                ? 'Indice 1/3 (Pièce)'
                : hintLevel === 1
                ? 'Indice 2/3 (Motif)'
                : 'Indice 3/3 (Solution)'}
            </span>
          </button>
        )}

        {!revealed && status !== 'success' && (
          <button
            onClick={handleRevealAll}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors flex items-center gap-1.5"
          >
            <span>Solution directe</span>
          </button>
        )}

        {status === 'success' && onNextMoment && (
          <button
            onClick={onNextMoment}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 shadow-md"
          >
            <span>Moment suivant</span>
            <FontAwesomeIcon icon={faArrowRight} className="w-3 h-3" />
          </button>
        )}

        <button
          onClick={onClose}
          className="ml-auto px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        >
          Reprendre la partie
        </button>
      </div>
    </div>
  );
};
