"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChessBoard } from '../ChessBoard';
import type { DemoStep } from '@chess-analyzer/chess-core';

export interface BoardDemoProps {
  /** Titre court, ex. « Comment l'adversaire peut exploiter ce coup » */
  title: string;
  /** Position de départ de la démonstration. */
  startFen: string;
  /** Étapes calculées par `buildDemo` (core). */
  steps: DemoStep[];
  onClose: () => void;
}

/**
 * Démonstration d'une variante sur l'échiquier.
 *
 * - joue la suite coup par coup, les deux camps alternent (la PV est
 *   naturellement alternée) ;
 * - met en évidence la pièce déplacée (départ → arrivée) et la menace
 *   (roi en échec) ;
 * - navigation : Précédent / Suivant / Quitter, plus ← → et Échap ;
 * - **ne touche jamais à la partie** : le plateau réel n'est pas modifié, la
 *   position de départ est restaurée dès la fermeture (l'état vit ici).
 */
export const BoardDemo: React.FC<BoardDemoProps> = ({ title, startFen, steps, onClose }) => {
  // -1 = position de départ ; 0..n-1 = après le coup i
  const [index, setIndex] = useState(-1);

  const isStart = index < 0;
  const isEnd = index >= steps.length - 1;
  const current = isStart ? null : steps[index];

  const fen = current ? current.fen : startFen;

  const next = useCallback(() => {
    setIndex(i => Math.min(i + 1, steps.length - 1));
  }, [steps.length]);

  const prev = useCallback(() => {
    setIndex(i => Math.max(i - 1, -1));
  }, []);

  // Clavier : ← / → / Échap. Ne doit pas interférer avec la page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        next();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        prev();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [next, prev, onClose]);

  const shapes = useMemo(() => {
    if (!current) return [];
    const out: Array<{ orig: string; dest?: string; brush: string }> = [
      // Pièce déplacée : départ en bleu pâle, arrivée en vert.
      { orig: current.from, dest: current.to, brush: 'paleGreen' },
      { orig: current.to, brush: 'green' },
    ];
    // Menace : case du roi en échec entourée de rouge.
    if (current.threat) out.push({ orig: current.threat, brush: 'red' });
    return out;
  }, [current]);

  const lastMove: [string, string] | undefined = current ? [current.from, current.to] : undefined;

  const stepLabel = isStart
    ? 'Position de départ'
    : `Coup ${index + 1} sur ${steps.length}`;

  return (
    <div
      className="fixed inset-0 z-[300] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="glass-panel rounded-2xl p-4 sm:p-5 w-full max-w-[520px] flex flex-col gap-3"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* En-tête */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-100 leading-tight">{title}</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">{stepLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg leading-none shrink-0"
            aria-label="Quitter la démonstration"
          >
            &#10005;
          </button>
        </div>

        {/* Échiquier de démonstration (isolé de la partie) */}
        <div className="w-full aspect-square rounded-xl overflow-hidden border border-slate-700 relative">
          <ChessBoard
            fen={fen}
            shapes={shapes}
            lastMove={lastMove}
            interactive={false}
          />
        </div>

        {/* Phrase de l'étape : courte, uniquement si elle apporte quelque chose */}
        <p
          className="text-sm text-slate-200 min-h-[2.5rem] leading-snug"
          aria-live="polite"
        >
          {current ? current.caption : 'Regardez la position, puis cliquez sur Suivant.'}
        </p>

        {/* Contrôles */}
        <div className="flex items-center gap-2">
          <button
            onClick={prev}
            disabled={isStart}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium border border-slate-700/60 text-slate-300 enabled:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            &#8592; Précédent
          </button>
          <button
            onClick={next}
            disabled={isEnd}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Suivant &#8594;
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm font-medium border border-slate-700/60 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Quitter
          </button>
        </div>

        <p className="text-[10px] text-slate-500 text-center">
          Votre partie n’est pas modifiée. ← → pour naviguer, Échap pour fermer.
        </p>
      </div>
    </div>
  );
};
