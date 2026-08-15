import React from 'react';
import type { ExplorerResult, OpeningData, TablebaseData } from '@chess-analyzer/chess-core';

export interface ExplorerProps {
  data: ExplorerResult;
  onMoveSelect?: (san: string) => void;
}

export const Explorer: React.FC<ExplorerProps> = ({ data, onMoveSelect }) => {
  if (!data) return null;

  if ('isOpening' in data) {
    const d = data as OpeningData;
    return (
      <div className="glass-panel rounded-xl p-4 w-full h-full text-slate-200 text-sm">
        <h3 className="font-bold text-slate-100 mb-3 flex items-center gap-2">
          <span>📖</span> Base de données Maîtres
        </h3>
        {d.moves.length === 0 ? (
          <div className="text-gray-500 text-center py-4">Aucune partie trouvée</div>
        ) : (
          <div className="space-y-2">
            {d.moves.slice(0, 10).map((move) => {
              const total = move.white + move.draws + move.black;
              const wPct = (move.white / total) * 100;
              const dPct = (move.draws / total) * 100;
              const bPct = (move.black / total) * 100;

              return (
                <div key={move.uci} className="flex items-center gap-3 hover:bg-gray-800 p-1 rounded cursor-pointer transition-colors" onClick={() => onMoveSelect?.(move.san)}>
                  <div className="w-12 font-medium text-gray-200">{move.san}</div>
                  <div className="w-16 text-right text-xs text-gray-400">{total.toLocaleString()}</div>
                  <div className="flex-1 h-2 flex rounded overflow-hidden opacity-90">
                    <div style={{ width: `${wPct}%` }} className="bg-gray-200" title={`Blancs: ${Math.round(wPct)}%`}></div>
                    <div style={{ width: `${dPct}%` }} className="bg-gray-500" title={`Nulles: ${Math.round(dPct)}%`}></div>
                    <div style={{ width: `${bPct}%` }} className="bg-gray-800 border-y border-r border-gray-700" title={`Noirs: ${Math.round(bPct)}%`}></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if ('tablebase' in data) {
    const d = data as TablebaseData;
    
    let globalStatusColor = 'text-gray-400';
    if (d.category === 'win' || d.category === 'cursed-win') globalStatusColor = 'text-green-400';
    if (d.category === 'loss' || d.category === 'blessed-loss') globalStatusColor = 'text-red-400';
    if (d.category === 'draw') globalStatusColor = 'text-gray-400';

    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 shadow-xl text-white text-sm w-full">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-bold text-gray-300 flex items-center gap-2">
            <span>♟️</span> Syzygy Tablebase (7 pièces)
          </h3>
          <span className={`font-bold capitalize ${globalStatusColor}`}>
            {d.category.replace('-', ' ')}
          </span>
        </div>
        
        {d.moves.length === 0 ? (
          <div className="text-gray-500 text-center py-4">Position finale atteinte</div>
        ) : (
          <div className="space-y-1">
            {d.moves.map((move) => {
              let color = 'text-gray-400';
              if (move.category.includes('win')) color = 'text-green-400';
              else if (move.category.includes('loss')) color = 'text-red-400';
              
              let dtzText = '';
              if (move.dtz !== undefined) {
                dtzText = `DTZ ${Math.abs(move.dtz)}`;
              }

              return (
                <div key={move.uci} className="flex justify-between items-center hover:bg-gray-800 p-2 rounded cursor-pointer transition-colors" onClick={() => onMoveSelect?.(move.san)}>
                  <span className="font-medium w-16">{move.san}</span>
                  <span className={`flex-1 text-right font-medium ${color}`}>{dtzText}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return null;
};
