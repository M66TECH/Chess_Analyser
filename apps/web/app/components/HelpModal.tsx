'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLightbulb, faXmark, faStar, faCheck } from '@fortawesome/free-solid-svg-icons';

export interface HelpModalProps {
  onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
  const shortcuts: Array<[string, string]> = [
    ['←', 'Coup précédent'],
    ['→', 'Coup suivant'],
    ['↑', 'Début de la partie'],
    ['↓', 'Fin de la partie'],
    ['F', "Retourner l'échiquier"],
    ['?', 'Ouvrir / fermer cette aide'],
    ['Esc', 'Fermer le dialogue actif'],
  ];

  const badges: Array<[React.ReactNode, string, string]> = [
    ['!!', 'Brillant', 'text-teal-300'],
    ['!', 'Superbe', 'text-blue-300'],
    [<FontAwesomeIcon key="best" icon={faStar} className="w-3.5 h-3.5 inline text-emerald-400" />, 'Meilleur coup', 'text-emerald-400'],
    [<FontAwesomeIcon key="good" icon={faCheck} className="w-3.5 h-3.5 inline text-emerald-300" />, 'Bon', 'text-emerald-300'],
    ['?!', 'Imprécision', 'text-yellow-300'],
    ['?', 'Erreur', 'text-orange-400'],
    ['??', 'Gaffe', 'text-red-400'],
  ];

  return (
    <div
      className="fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="glass-panel rounded-2xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Aide & Raccourcis"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <FontAwesomeIcon icon={faLightbulb} className="text-amber-400 w-4 h-4" /> Aide & Raccourcis
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
            aria-label="Fermer"
          >
            <FontAwesomeIcon icon={faXmark} className="w-4 h-4" />
          </button>
        </div>

        <h3 className="text-sm font-semibold text-slate-300 mb-2">Raccourcis clavier</h3>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {shortcuts.map(([key, action]) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              <kbd className="px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs font-mono text-slate-200 min-w-[28px] text-center">
                {key}
              </kbd>
              <span className="text-slate-400">{action}</span>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-semibold text-slate-300 mb-2">Classification des coups</h3>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {badges.map(([icon, label, color]) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <span className={`font-bold ${color} w-8 text-center`}>{icon}</span>
              <span className="text-slate-400">{label}</span>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-semibold text-slate-300 mb-2">Conseils</h3>
        <ul className="text-sm text-slate-400 space-y-1.5 list-disc list-inside">
          <li>Jouez un coup ou importez un PGN pour lancer l&apos;analyse.</li>
          <li>Les <span className="text-green-400">flèches vertes</span> indiquent le meilleur coup selon Stockfish.</li>
          <li>Les <span className="text-red-400">cercles rouges</span> signalent les pièces en prise non défendues.</li>
          <li>Les <span className="text-blue-400">cercles bleus</span> montrent les pièces clouées.</li>
          <li>Le coach IA explique chaque coup en langage naturel.</li>
          <li>Votre partie est sauvegardée automatiquement dans votre navigateur.</li>
        </ul>
      </div>
    </div>
  );
}
