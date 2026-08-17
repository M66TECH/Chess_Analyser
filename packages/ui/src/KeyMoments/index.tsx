import React from 'react';
import type { MoveRecord } from '@chess-analyzer/chess-core';
import { uciToSan } from '@chess-analyzer/chess-core';

export interface KeyMomentsProps {
  records: MoveRecord[];
  onNodeSelect?: (nodeId: string) => void;
}

export const KeyMoments: React.FC<KeyMomentsProps> = ({ records, onNodeSelect }) => {
  // Filter only blunders and mistakes as key moments
  const keyMoments = records.filter(r => r.classification === 'blunder' || r.classification === 'mistake');

  if (keyMoments.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 shadow-xl text-white text-sm w-full">
        <h3 className="font-bold text-gray-300 mb-3 flex items-center gap-2">
          <span>⚡</span> Moments Clés
        </h3>
        <div className="text-gray-500 text-center py-4">Aucune erreur majeure détectée.</div>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl p-4 w-full h-full overflow-y-auto custom-scrollbar">
      <h3 className="font-bold text-gray-300 mb-3 flex items-center gap-2">
        <span>⚡</span> Moments Clés
      </h3>
      <div className="space-y-2">
        {keyMoments.map((moment, idx) => {
          const isBlunder = moment.classification === 'blunder';
          const bgColor = isBlunder ? 'bg-red-900/30' : 'bg-orange-900/30';
          const borderColor = isBlunder ? 'border-red-900' : 'border-orange-900';
          const icon = isBlunder ? '??' : '?';
          const textColor = isBlunder ? 'text-red-400' : 'text-orange-400';
          const who = moment.color === 'white' ? 'Blancs' : 'Noirs';
          const moveTitle = `${Math.floor(moment.moveNumber)}... ${moment.san} ${icon}`;

          return (
            <div 
              key={moment.nodeId || idx} 
              className={`border ${borderColor} ${bgColor} rounded p-3 hover:bg-gray-800 cursor-pointer transition-colors flex flex-col gap-1`}
              onClick={() => onNodeSelect?.(moment.nodeId)}
            >
              <div className="flex justify-between items-center">
                <span className={`font-bold ${textColor}`}>{moveTitle}</span>
                <span className="text-xs text-gray-400">
                  {moment.cpBefore !== undefined && moment.cpAfter !== undefined ? (
                    `${(moment.cpBefore / 100).toFixed(1)} ➡️ ${(moment.cpAfter / 100).toFixed(1)}`
                  ) : ''}
                </span>
              </div>
              <div className="text-gray-300 text-xs">
                Gaffe des {who}. Meilleur coup : <span className="font-bold">{moment.bestMove ? (uciToSan(moment.fenBefore, moment.bestMove) ?? moment.bestMove) : 'Inconnu'}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
