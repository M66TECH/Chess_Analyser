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
  faShieldHalved,
} from '@fortawesome/free-solid-svg-icons';

export interface NavigationBarProps {
  depthLabel: string;
  engineStatus: 'idle' | 'analyzing' | 'ready' | 'error';
  engineSource?: 'cloud' | 'local';
  soundEnabled: boolean;
  onToggleSound: () => void;
  /** P3.14 — mode local strict : coupe Lichess (explorateur/nuage) et le LLM. */
  localOnly: boolean;
  onToggleLocalOnly: () => void;
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
  onToggleSound,
  localOnly,
  onToggleLocalOnly,
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

        {/* P3.14 — Mode local strict : aucune donnée ne quitte le navigateur. */}
        <button
          onClick={onToggleLocalOnly}
          aria-pressed={localOnly}
          className={`px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors border flex items-center gap-1.5 ${
            localOnly
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
              : 'bg-slate-800/70 hover:bg-slate-700 text-slate-300 border-slate-700/50'
          }`}
          title={
            localOnly
              ? 'Mode local : rien ne quitte votre navigateur (cliquez pour réactiver le nuage et le coach IA)'
              : 'Mode connecté : Lichess (ouvertures/nuage) et coach IA sont utilisés'
          }
          aria-label={localOnly ? 'Désactiver le mode local' : 'Activer le mode local'}
        >
          <FontAwesomeIcon icon={faShieldHalved} className="text-xs" />
          <span className="hidden sm:inline">{localOnly ? 'Local' : 'Connecté'}</span>
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
