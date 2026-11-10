"use client";
import React from 'react';
import type { DemoStep } from '@chess-analyzer/chess-core';
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

export interface DemoBannerProps {
  title: string;
  steps: DemoStep[];
  currentIndex: number; // -1 = start, 0..n-1
  isPlaying: boolean;
  mode?: 'idea' | 'punish';
  hasBothModes?: boolean;
  onSwitchMode?: (mode: 'idea' | 'punish') => void;
  onNext: () => void;
  onPrev: () => void;
  onTogglePlay: () => void;
  onReset: () => void;
  onGoTo: (index: number) => void;
  onClose: () => void;
}

export const DemoBanner: React.FC<DemoBannerProps> = ({
  title,
  steps,
  currentIndex,
  isPlaying,
  mode = 'idea',
  hasBothModes,
  onSwitchMode,
  onNext,
  onPrev,
  onTogglePlay,
  onReset,
  onGoTo,
  onClose,
}) => {
  const isStart = currentIndex < 0;
  const isEnd = currentIndex >= steps.length - 1;
  const current = isStart ? null : steps[currentIndex];

  const stepLabel = isStart
    ? 'Position de départ'
    : `Coup ${currentIndex + 1} / ${steps.length}${current?.san ? ` · ${current.san}` : ''}`;

  return (
    <div className="glass-panel rounded-xl p-3 sm:p-4 border border-indigo-500/40 bg-slate-900/95 shadow-xl flex flex-col gap-2.5 animate-in fade-in duration-150">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 shrink-0">
            <FontAwesomeIcon icon={mode === 'punish' ? faBullseye : faLightbulb} className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-100">{title}</span>
              <span className="text-[11px] text-indigo-300 font-medium px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">
                {stepLabel}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors shrink-0"
          title="Fermer la démonstration (Échap)"
          aria-label="Fermer"
        >
          <FontAwesomeIcon icon={faXmark} className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs if both best move and refutation exist */}
      {hasBothModes && onSwitchMode && (
        <div className="flex rounded-lg bg-slate-800/80 p-0.5 text-xs font-medium">
          <button
            onClick={() => onSwitchMode('idea')}
            className={`flex-1 py-1 rounded-md transition-all text-center flex items-center justify-center gap-1.5 ${
              mode === 'idea' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FontAwesomeIcon icon={faLightbulb} className="w-3 h-3 text-amber-300" />
            <span>Ce qu&apos;il fallait jouer</span>
          </button>
          <button
            onClick={() => onSwitchMode('punish')}
            className={`flex-1 py-1 rounded-md transition-all text-center flex items-center justify-center gap-1.5 ${
              mode === 'punish' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FontAwesomeIcon icon={faBullseye} className="w-3 h-3 text-rose-200" />
            <span>Réfutation adverse</span>
          </button>
        </div>
      )}

      {/* Caption description */}
      <div className="bg-slate-800/60 rounded-lg px-3 py-2 border border-slate-700/50 flex items-center gap-2">
        {current?.san && (
          <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 font-mono text-xs font-bold rounded shrink-0">
            {current.san}
          </span>
        )}
        <p className="text-xs text-slate-200 leading-relaxed">
          {current ? current.caption : steps[0] ? 'Position de départ. Cliquez sur Suivant ou Lecture pour voir le coup.' : 'Position observée.'}
        </p>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-2">
        {/* Scrubber dots */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onGoTo(-1)}
            className={`h-2 rounded-full transition-all ${
              isStart ? 'w-5 bg-indigo-500' : 'w-2 bg-slate-700 hover:bg-slate-500'
            }`}
            title="Position de départ"
          />
          {steps.map((s, i) => (
            <button
              key={i}
              onClick={() => onGoTo(i)}
              className={`h-2 rounded-full transition-all ${
                currentIndex === i ? 'w-5 bg-indigo-500' : 'w-2 bg-slate-700 hover:bg-slate-500'
              }`}
              title={s.san ? `Coup ${i + 1} : ${s.san}` : `Coup ${i + 1}`}
            />
          ))}
        </div>

        <div className="flex-1" />

        {/* Buttons */}
        <button
          onClick={onReset}
          className="p-1.5 rounded-lg text-xs border border-slate-700/60 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Revenir au début"
        >
          <FontAwesomeIcon icon={faRotateLeft} className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onPrev}
          disabled={isStart}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-700/60 text-slate-300 enabled:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
        >
          <FontAwesomeIcon icon={faChevronLeft} className="w-3 h-3" />
          <span>Précédent</span>
        </button>
        <button
          onClick={onTogglePlay}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
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
          onClick={onNext}
          disabled={isEnd}
          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
        >
          <span>Suivant</span>
          <FontAwesomeIcon icon={faChevronRight} className="w-3 h-3" />
        </button>
        <button
          onClick={onClose}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-700/60 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          Quitter
        </button>
      </div>
    </div>
  );
};
