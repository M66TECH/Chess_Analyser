"use client";
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { ChessBoard } from '../ChessBoard';
import type { DemoStep } from '@chess-analyzer/chess-core';
import { SoundService } from '../sound/SoundService';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlay,
  faPause,
  faChevronLeft,
  faChevronRight,
  faRotateLeft,
  faXmark,
  faLightbulb,
  faBullseye,
} from '@fortawesome/free-solid-svg-icons';

export * from './DemoBanner';

export interface BoardDemoProps {
  /** Titre court, ex. « Comment l'adversaire peut exploiter ce coup » */
  title: string;
  /** Position de départ de la démonstration. */
  startFen: string;
  /** Étapes calculées par `buildDemo` (core). */
  steps: DemoStep[];
  /** Orientation de l'échiquier (fixe tout au long de la démonstration). */
  orientation?: 'white' | 'black';
  /** Mode actif si bascule disponible : meilleure ligne ('idea') ou réfutation ('punish'). */
  mode?: 'idea' | 'punish';
  onSwitchMode?: (mode: 'idea' | 'punish') => void;
  hasBothModes?: boolean;
  onClose: () => void;
}

/**
 * Démonstration interactive et sonore d'une variante sur l'échiquier.
 *
 * - Joue la suite coup par coup avec son échiquéen synchronisé ;
 * - Mode lecture automatique (Autoplay) avec bouton Play/Pause et raccourci Espace ;
 * - Orientation verrouillée pour éviter tout retournement intempestif ;
 * - Flèches nettes de déplacement vert Lichess et mise en évidence de l'échec ;
 * - Possibilité d'alterner entre l'idée recommandée et la réfutation adverse ;
 * - Ne modifie jamais l'état de la partie principale.
 */
export const BoardDemo: React.FC<BoardDemoProps> = ({
  title,
  startFen,
  steps,
  orientation = 'white',
  mode,
  onSwitchMode,
  hasBothModes,
  onClose,
}) => {
  // -1 = position de départ ; 0..n-1 = après le coup i
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const autoPlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isStart = index < 0;
  const isEnd = index >= steps.length - 1;
  const current = isStart ? null : steps[index];
  const fen = current ? current.fen : startFen;

  // Joue le son correspondant à l'étape
  const playStepSound = useCallback((step: DemoStep | null) => {
    if (!step) {
      SoundService.getInstance().play('move');
      return;
    }
    if (step.checkmate || step.check) {
      SoundService.getInstance().play('check');
    } else if (step.caption.includes('prend') || step.san?.includes('x')) {
      SoundService.getInstance().play('capture');
    } else {
      SoundService.getInstance().play('move');
    }
  }, []);

  const goTo = useCallback(
    (targetIndex: number) => {
      const clamped = Math.max(-1, Math.min(targetIndex, steps.length - 1));
      setIndex(clamped);
      if (clamped >= 0 && clamped < steps.length) {
        playStepSound(steps[clamped]);
      } else {
        SoundService.getInstance().play('move');
      }
    },
    [steps, playStepSound]
  );

  const next = useCallback(() => {
    if (index < steps.length - 1) {
      goTo(index + 1);
    } else {
      setIsPlaying(false);
    }
  }, [index, steps.length, goTo]);

  const prev = useCallback(() => {
    goTo(index - 1);
  }, [index, goTo]);

  const reset = useCallback(() => {
    goTo(-1);
    setIsPlaying(false);
  }, [goTo]);

  // Autoplay loop
  useEffect(() => {
    if (!isPlaying) {
      if (autoPlayTimer.current) clearTimeout(autoPlayTimer.current);
      return;
    }

    if (isEnd) {
      setIsPlaying(false);
      return;
    }

    autoPlayTimer.current = setTimeout(() => {
      next();
    }, 1300);

    return () => {
      if (autoPlayTimer.current) clearTimeout(autoPlayTimer.current);
    };
  }, [isPlaying, isEnd, next]);

  // Raccourcis clavier : ← / → / Espace (Play/Pause) / Échap
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setIsPlaying(false);
        next();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setIsPlaying(false);
        prev();
      } else if (event.key === ' ') {
        event.preventDefault();
        setIsPlaying((p) => !p);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [next, prev, onClose]);

  // Flèches sur l'échiquier
  const shapes = useMemo(() => {
    // Si à la position de départ (-1), on montre immédiatement la flèche du premier coup à venir
    if (isStart) {
      const first = steps[0];
      if (first) {
        return [{ orig: first.from, dest: first.to, brush: 'green' }];
      }
      return [];
    }

    if (!current) return [];

    const out: Array<{ orig: string; dest?: string; brush: string }> = [
      // Coup qui vient d'être joué : flèche verte nette
      { orig: current.from, dest: current.to, brush: 'green' },
    ];

    // Menace d'échec : case du roi entourée de rouge
    if (current.threat) {
      out.push({ orig: current.threat, brush: 'red' });
    }

    // Coup suivant suggéré (en bleu pâle discret si présent)
    const nextStep = steps[index + 1];
    if (nextStep) {
      out.push({ orig: nextStep.from, dest: nextStep.to, brush: 'paleBlue' });
    }

    return out;
  }, [isStart, current, steps, index]);

  const lastMove: [string, string] | undefined = current ? [current.from, current.to] : undefined;

  const stepLabel = isStart
    ? 'Position de départ'
    : `Coup ${index + 1} / ${steps.length}${current?.san ? ` · ${current.san}` : ''}`;

  return (
    <div
      className="fixed inset-0 z-[300] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="glass-panel rounded-2xl p-4 sm:p-5 w-full max-w-[520px] flex flex-col gap-3 shadow-2xl border border-slate-700/60"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* En-tête */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-indigo-500/20 text-indigo-400">
                <FontAwesomeIcon icon={mode === 'punish' ? faBullseye : faLightbulb} className="w-3.5 h-3.5" />
              </span>
              <h2 className="text-sm font-bold text-slate-100 leading-tight">{title}</h2>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 font-medium">{stepLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800/60 transition-colors shrink-0"
            aria-label="Quitter la démonstration"
            title="Quitter (Échap)"
          >
            <FontAwesomeIcon icon={faXmark} className="w-4 h-4" />
          </button>
        </div>

        {/* Onglets d'alternance Idée / Réfutation si les deux existent */}
        {hasBothModes && onSwitchMode && (
          <div className="flex rounded-lg bg-slate-800/80 p-0.5 text-xs font-medium">
            <button
              onClick={() => {
                setIsPlaying(false);
                setIndex(-1);
                onSwitchMode('idea');
              }}
              className={`flex-1 py-1.5 rounded-md transition-all text-center flex items-center justify-center gap-1.5 ${
                mode === 'idea' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FontAwesomeIcon icon={faLightbulb} className="w-3 h-3 text-amber-300" />
              <span>Ce qu&apos;il fallait jouer</span>
            </button>
            <button
              onClick={() => {
                setIsPlaying(false);
                setIndex(-1);
                onSwitchMode('punish');
              }}
              className={`flex-1 py-1.5 rounded-md transition-all text-center flex items-center justify-center gap-1.5 ${
                mode === 'punish' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FontAwesomeIcon icon={faBullseye} className="w-3 h-3 text-rose-200" />
              <span>Réfutation adverse</span>
            </button>
          </div>
        )}

        {/* Échiquier de démonstration avec orientation verrouillée */}
        <div className="w-full aspect-square rounded-xl overflow-hidden border border-slate-700/80 relative shadow-inner bg-slate-900">
          <ChessBoard
            fen={fen}
            orientation={orientation}
            shapes={shapes}
            lastMove={lastMove}
            interactive={false}
          />
        </div>

        {/* Scrubber / Indicateurs d'étapes */}
        <div className="flex items-center gap-1.5 px-1">
          <button
            onClick={() => goTo(-1)}
            className={`h-2 rounded-full transition-all ${
              isStart ? 'w-6 bg-indigo-500' : 'w-2 bg-slate-700 hover:bg-slate-500'
            }`}
            title="Position initiale"
          />
          {steps.map((s, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`h-2 rounded-full transition-all ${
                index === i ? 'w-6 bg-indigo-500' : 'w-2 bg-slate-700 hover:bg-slate-500'
              }`}
              title={s.san ? `Coup ${i + 1} : ${s.san}` : `Coup ${i + 1}`}
            />
          ))}
        </div>

        {/* Explication du coup */}
        <div className="min-h-[2.5rem] bg-slate-850/60 rounded-lg p-2.5 border border-slate-800 text-slate-200 flex items-center gap-2">
          {current?.san && (
            <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 font-mono text-xs font-bold rounded shrink-0">
              {current.san}
            </span>
          )}
          <p className="text-xs leading-relaxed" aria-live="polite">
            {current ? current.caption : steps[0] ? `La suite débute par le coup suggéré.` : 'Regardez la position.'}
          </p>
        </div>

        {/* Contrôles de lecture */}
        <div className="flex items-center gap-2">
          <button
            onClick={reset}
            className="p-2 rounded-lg text-sm border border-slate-700/60 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Revenir au début"
          >
            <FontAwesomeIcon icon={faRotateLeft} className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={prev}
            disabled={isStart}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-medium border border-slate-700/60 text-slate-300 enabled:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
          >
            <FontAwesomeIcon icon={faChevronLeft} className="w-3 h-3" />
            <span>Précédent</span>
          </button>
          <button
            onClick={() => setIsPlaying((p) => !p)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
              isPlaying
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
            title="Lecture automatique (Espace)"
          >
            <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} className="w-3 h-3" />
            <span>{isPlaying ? 'Pause' : 'Lecture'}</span>
          </button>
          <button
            onClick={next}
            disabled={isEnd}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
          >
            <span>Suivant</span>
            <FontAwesomeIcon icon={faChevronRight} className="w-3 h-3" />
          </button>
        </div>

        <p className="text-[10px] text-slate-500 text-center">
          ← → pour naviguer · Espace pour lire · Échap pour quitter
        </p>
      </div>
    </div>
  );
};
