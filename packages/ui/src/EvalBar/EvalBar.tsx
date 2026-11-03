import React from 'react';
import { formatEval } from '@chess-analyzer/chess-core';

export interface EvalBarProps {
  /** Probabilité de victoire normalisée, [-1, 1], point de vue des Blancs. */
  winProb: number;
  /** Centipions, point de vue des Blancs (normalisés par le pipeline). */
  cp?: number;
  /** Mat en N coups, point de vue des Blancs (négatif = Noirs matent). */
  mate?: number;
  /** Camp affiché en bas de l'échiquier. */
  orientation?: 'white' | 'black';
}

/** Part (%) du camp affiché en bas. Bornée pour éviter `height: NaN%`. */
const bottomShare = (winProb: number, orientation: 'white' | 'black'): number => {
  const clamped = Number.isFinite(winProb) ? Math.min(1, Math.max(-1, winProb)) : 0;
  const whiteShare = ((clamped + 1) / 2) * 100;
  return orientation === 'white' ? whiteShare : 100 - whiteShare;
};

export const EvalBar: React.FC<EvalBarProps> = ({ winProb, cp, mate, orientation = 'white' }) => {
  const share = bottomShare(winProb, orientation);
  const text = formatEval(cp, mate);

  // Le texte se place dans la zone du camp en tête.
  const whiteAhead = Number.isFinite(winProb) ? winProb >= 0 : true;
  const textAtBottom = orientation === 'white' ? whiteAhead : !whiteAhead;
  const textClass = textAtBottom ? 'bottom-0 text-slate-900' : 'top-0 text-slate-100';

  return (
    <div
      className="relative w-6 sm:w-8 h-full bg-slate-800 rounded-lg overflow-hidden border border-slate-700 shrink-0"
      role="meter"
      aria-label={`Évaluation Stockfish : ${text}`}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Number.isFinite(winProb) ? Number(winProb.toFixed(3)) : 0}
      title={`Évaluation ${text}`}
    >
      {/* Zone du camp affiché en bas (blanc clair ou sombre) */}
      <div
        className={`absolute bottom-0 w-full transition-[height] duration-300 ease-out ${
          orientation === 'white' ? 'bg-slate-100' : 'bg-slate-700'
        }`}
        style={{ height: `${share}%` }}
      />

      {/* Ligne d'égalité */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-slate-500/60 z-10" />

      <div
        className={`absolute w-full text-center text-[10px] font-semibold py-0.5 z-20 font-mono tabular-nums ${textClass}`}
      >
        {text}
      </div>
    </div>
  );
};
