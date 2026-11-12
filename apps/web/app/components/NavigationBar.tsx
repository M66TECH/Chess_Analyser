'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChessKnight,
  faFolderOpen,
  faDownload,
  faRotate,
  faVolumeHigh,
  faVolumeXmark,
  faCircleQuestion,
} from '@fortawesome/free-solid-svg-icons';

export type PlayerLevel = 'debutant' | 'intermediaire' | 'avance';

export interface NavigationBarProps {
  depthLabel: string;
  engineStatus: 'idle' | 'analyzing' | 'ready' | 'error';
  engineSource?: 'cloud' | 'local';
  soundEnabled: boolean;
  playerLevel?: PlayerLevel;
  onChangePlayerLevel?: (level: PlayerLevel) => void;
  onToggleSound: () => void;
  onImport: () => void;
  onExport: () => void;
  onReset: () => void;
  onHelp: () => void;
}

export function NavigationBar({
  depthLabel,
  engineStatus,
  engineSource,
  soundEnabled,
  playerLevel = 'intermediaire',
  onChangePlayerLevel,
  onToggleSound,
  onImport,
  onExport,
  onReset,
  onHelp,
}: NavigationBarProps) {
  const statusDotClass =
    engineStatus === 'error'
      ? 'bg-red-400'
      : engineSource === 'cloud'
      ? 'bg-sky-400'
      : engineStatus === 'ready'
      ? 'bg-green-400'
      : engineStatus === 'analyzing'
      ? 'bg-amber-400 animate-pulse'
      : 'bg-slate-500';

  const engineTitle =
    engineSource === 'cloud'
      ? 'Évaluation depuis le nuage de Lichess'
      : 'Analyse Stockfish locale';

  return (
    <nav className="sticky top-0 z-50 glass-panel border-b border-slate-700/50 px-4 py-2.5 flex items-center justify-between gap-4">
      {/* Brand Logo */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 bg-indigo-500/20 rounded-lg flex items-center justify-center ring-1 ring-indigo-500/30">
          <FontAwesomeIcon icon={faChessKnight} className="text-base text-indigo-400" />
        </div>
        <div className="hidden sm:block">
          <h1 className="text-sm font-bold text-slate-100 leading-tight">Chess Analyzer</h1>
          <p className="text-[10px] text-indigo-400/70 leading-tight">Coach IA d&apos;échecs</p>
        </div>
      </div>

      {/* Engine Status Indicator */}
      <div
        className="hidden md:flex items-center gap-2 text-xs text-slate-400 glass-panel-light rounded-lg px-3 py-1.5"
        title={engineTitle}
      >
        <span className={`w-2 h-2 rounded-full ${statusDotClass}`} />
        <span className="font-mono">{depthLabel}</span>
      </div>

      {/* Player Level Selector (O15) */}
      {onChangePlayerLevel && (
        <div
          className="hidden md:flex items-center gap-1 bg-slate-900/80 p-1 rounded-lg border border-slate-700/50 text-xs"
          role="radiogroup"
          aria-label="Niveau du joueur"
          title="Niveau du joueur pour adapter les explications pédagogiques"
        >
          {(
            [
              { id: 'debutant', label: 'Débutant' },
              { id: 'intermediaire', label: 'Intermédiaire' },
              { id: 'avance', label: 'Avancé' },
            ] as const
          ).map(({ id, label }) => {
            const active = playerLevel === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChangePlayerLevel(id)}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onImport}
          className="px-3 py-1.5 bg-slate-800/70 hover:bg-slate-700 rounded-lg text-xs sm:text-sm font-medium transition-colors border border-slate-700/50 flex items-center gap-1.5 text-slate-300 hover:text-white"
          title="Importer une partie PGN"
          aria-label="Importer PGN"
        >
          <FontAwesomeIcon icon={faFolderOpen} className="text-xs text-slate-400" />
          <span className="hidden sm:inline">Importer</span>
        </button>

        <button
          onClick={onExport}
          className="px-3 py-1.5 bg-slate-800/70 hover:bg-slate-700 rounded-lg text-xs sm:text-sm font-medium transition-colors border border-slate-700/50 flex items-center gap-1.5 text-slate-300 hover:text-white"
          title="Exporter en PGN"
          aria-label="Exporter PGN"
        >
          <FontAwesomeIcon icon={faDownload} className="text-xs text-slate-400" />
          <span className="hidden sm:inline">Exporter</span>
        </button>

        <button
          onClick={onReset}
          className="px-3 py-1.5 bg-slate-800/70 hover:bg-red-900/40 rounded-lg text-xs sm:text-sm font-medium transition-colors border border-slate-700/50 flex items-center gap-1.5 text-slate-300 hover:text-red-300"
          title="Nouvelle partie"
          aria-label="Nouvelle partie"
        >
          <FontAwesomeIcon icon={faRotate} className="text-xs" />
          <span className="hidden sm:inline">Recommencer</span>
        </button>

        <button
          onClick={onToggleSound}
          className="px-2.5 py-1.5 bg-slate-800/70 hover:bg-slate-700 rounded-lg text-xs sm:text-sm font-medium transition-colors border border-slate-700/50 flex items-center gap-1.5 text-slate-300 hover:text-white"
          title={soundEnabled ? 'Désactiver les sons' : 'Activer les sons'}
          aria-label={soundEnabled ? 'Désactiver les sons' : 'Activer les sons'}
        >
          <FontAwesomeIcon icon={soundEnabled ? faVolumeHigh : faVolumeXmark} className="text-xs" />
          <span className="hidden sm:inline">{soundEnabled ? 'Son' : 'Muet'}</span>
        </button>

        <button
          onClick={onHelp}
          className="px-2.5 py-1.5 bg-slate-800/70 hover:bg-slate-700 rounded-lg text-sm font-bold transition-colors border border-slate-700/50 text-slate-400 hover:text-white flex items-center justify-center"
          title="Aide & raccourcis (touche ?)"
          aria-label="Aide"
        >
          <FontAwesomeIcon icon={faCircleQuestion} className="text-sm" />
        </button>
      </div>
    </nav>
  );
}
