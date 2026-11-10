import React from 'react';
import type { MoveRecord, MoveClassification } from '@chess-analyzer/chess-core';
import { uciToSan } from '@chess-analyzer/chess-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBoltLightning } from '@fortawesome/free-solid-svg-icons';

export interface KeyMomentsProps {
  records: MoveRecord[];
  onNodeSelect?: (nodeId: string) => void;
  onRetryBlunder?: (record: MoveRecord) => void;
  onStartReview?: () => void;
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

export const KeyMoments: React.FC<KeyMomentsProps> = ({
  records,
  onNodeSelect,
  onRetryBlunder,
  onStartReview,
}) => {
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
          <FontAwesomeIcon icon={faBoltLightning} className="text-amber-400 w-3.5 h-3.5" />
          <span>Moments Clés</span>
        </h3>
        <div className="text-slate-500 text-center py-4 text-sm flex-1 flex items-center justify-center">
          Aucun moment marquant. Jouez pour voir apparaître vos gaffes et vos coups brillants.
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl p-3 w-full h-full overflow-y-auto custom-scrollbar">
      <div className="flex items-center justify-between gap-1 mb-3">
        <h3 className="font-bold text-slate-300 flex items-center gap-1.5 text-sm">
          <FontAwesomeIcon icon={faBoltLightning} className="text-amber-400 w-3.5 h-3.5" />
          <span>Moments Clés</span>
          <span className="text-xs text-slate-500 font-normal">({keyMoments.length})</span>
        </h3>
        {onStartReview && (
          <button
            onClick={onStartReview}
            className="text-[11px] font-semibold px-2 py-0.5 rounded bg-indigo-600/80 hover:bg-indigo-600 text-white transition-colors"
          >
            Revue
          </button>
        )}
      </div>
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
                <div className="flex flex-col gap-1.5">
                  <div className="text-slate-400 text-xs leading-snug">
                    {cfg.label} des {who}. Meilleur coup :{' '}
                    <span className="font-bold text-slate-300">
                      {moment.bestMove ? (uciToSan(moment.fenBefore, moment.bestMove) ?? moment.bestMove) : 'Inconnu'}
                    </span>
                  </div>
                  {onRetryBlunder && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRetryBlunder(moment);
                      }}
                      className="self-start px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-600/40 hover:bg-indigo-600 text-indigo-200 border border-indigo-500/40 transition-colors flex items-center gap-1"
                    >
                      <span>&#127919;</span> Retenter
                    </button>
                  )}
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
