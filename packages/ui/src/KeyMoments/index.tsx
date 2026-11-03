import React from 'react';
import type { MoveRecord, MoveClassification } from '@chess-analyzer/chess-core';
import { uciToSan } from '@chess-analyzer/chess-core';

export interface KeyMomentsProps {
  records: MoveRecord[];
  onNodeSelect?: (nodeId: string) => void;
}

interface MomentConfig {
  label: string;
  icon: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
}

const MOMENT_CONFIG: Partial<Record<MoveClassification, MomentConfig>> = {
  blunder: { label: 'Gaffe', icon: '??', bgColor: 'bg-red-900/30', borderColor: 'border-red-700/60', textColor: 'text-red-400' },
  mistake: { label: 'Erreur', icon: '?', bgColor: 'bg-orange-900/30', borderColor: 'border-orange-700/60', textColor: 'text-orange-400' },
  brilliant: { label: 'Brillant', icon: '!!', bgColor: 'bg-teal-900/30', borderColor: 'border-teal-700/60', textColor: 'text-teal-300' },
  great: { label: 'Superbe', icon: '!', bgColor: 'bg-blue-900/30', borderColor: 'border-blue-700/60', textColor: 'text-blue-300' },
};

const KEY_CLASSIFICATIONS: MoveClassification[] = ['blunder', 'mistake', 'brilliant', 'great'];

export const KeyMoments: React.FC<KeyMomentsProps> = ({ records, onNodeSelect }) => {
  // Inclure gaffes, erreurs ET coups remarquables (brillant, superbe).
  // Tri par impact décroissant : la plus grosse gaffe apparaît en premier.
  const keyMoments = records
    .filter(r => KEY_CLASSIFICATIONS.includes(r.classification))
    .sort((a, b) => {
      const impact = (r: MoveRecord) => Math.abs(r.cpAfter - r.cpBefore);
      return impact(b) - impact(a);
    });

  if (keyMoments.length === 0) {
    return (
      <div className="glass-panel rounded-xl p-4 w-full h-full flex flex-col">
        <h3 className="font-bold text-slate-300 mb-3 flex items-center gap-2 text-sm">
          <span className="text-amber-400">&#9889;</span> Moments Clés
        </h3>
        <div className="text-slate-500 text-center py-4 text-sm flex-1 flex items-center justify-center">
          Aucun moment marquant. Jouez pour voir apparaître vos gaffes et vos coups brillants.
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl p-3 w-full h-full overflow-y-auto custom-scrollbar">
      <h3 className="font-bold text-slate-300 mb-3 flex items-center gap-2 text-sm">
        <span className="text-amber-400">&#9889;</span> Moments Clés
        <span className="ml-auto text-xs text-slate-500 font-normal">{keyMoments.length}</span>
      </h3>
      <div className="space-y-2">
        {keyMoments.map((moment, idx) => {
          const cfg = MOMENT_CONFIG[moment.classification] ?? MOMENT_CONFIG.mistake!;
          const isGood = moment.classification === 'brilliant' || moment.classification === 'great';
          const who = moment.color === 'white' ? 'Blancs' : 'Noirs';
          const moveTitle = `${Math.floor(moment.moveNumber)}${moment.color === 'white' ? '.' : '...'} ${moment.san}`;

          return (
            <div
              key={moment.nodeId || idx}
              role="button"
              tabIndex={0}
              className={`border ${cfg.borderColor} ${cfg.bgColor} rounded-lg p-2.5 hover:bg-slate-800/80 cursor-pointer transition-colors flex flex-col gap-1 focus:outline-none focus:ring-2 focus:ring-indigo-500/50`}
              onClick={() => onNodeSelect?.(moment.nodeId)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNodeSelect?.(moment.nodeId); } }}
              aria-label={`${cfg.label} des ${who}: ${moment.san}`}
            >
              <div className="flex justify-between items-center">
                <span className={`font-bold text-sm ${cfg.textColor}`}>
                  {moveTitle} <span className="text-xs opacity-80">{cfg.icon}</span>
                </span>
                {moment.cpBefore !== undefined && moment.cpAfter !== undefined && (
                  <span className="text-xs text-slate-400 font-mono">
                    {(moment.cpBefore / 100).toFixed(1)} → {(moment.cpAfter / 100).toFixed(1)}
                  </span>
                )}
              </div>
              {!isGood && (
                <div className="text-slate-400 text-xs leading-snug">
                  {cfg.label} des {who}. Meilleur coup :{' '}
                  <span className="font-bold text-slate-300">
                    {moment.bestMove ? (uciToSan(moment.fenBefore, moment.bestMove) ?? moment.bestMove) : 'Inconnu'}
                  </span>
                </div>
              )}
              {isGood && (
                <div className="text-slate-400 text-xs leading-snug">
                  {cfg.label} des {who} !
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
