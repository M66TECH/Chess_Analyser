import React from 'react';
import { MoveRecord, MoveClassification } from '@chess-analyzer/chess-core';

interface MoveListProps {
  records: MoveRecord[];
  activeIndex?: number;
  onNodeClick?: (index: number) => void;
}

const getBadgeColor = (classification: MoveClassification) => {
  switch (classification) {
    case 'blunder': return 'bg-red-500';
    case 'mistake': return 'bg-orange-500';
    case 'inaccuracy': return 'bg-yellow-400';
    case 'brilliant': return 'bg-teal-400';
    case 'great': return 'bg-blue-400';
    case 'best': return 'bg-green-500';
    case 'excellent': return 'bg-green-400';
    case 'book': return 'bg-purple-400';
    default: return 'bg-transparent';
  }
};

const getBadgeText = (classification: MoveClassification) => {
  switch (classification) {
    case 'blunder': return '??';
    case 'mistake': return '?';
    case 'inaccuracy': return '?!';
    case 'brilliant': return '!!';
    case 'great': return '!';
    case 'best': return '★';
    case 'book': return '📖';
    default: return '';
  }
};

export const MoveList: React.FC<MoveListProps> = ({ records, activeIndex, onNodeClick }) => {
  // Group records into pairs (White, Black)
  const rows: { moveNumber: number; white?: MoveRecord; black?: MoveRecord; whiteIndex?: number; blackIndex?: number }[] = [];
  
  let currentRow: any = null;
  
  records.forEach((record, index) => {
    if (record.color === 'white') {
      currentRow = { moveNumber: record.moveNumber, white: record, whiteIndex: index };
      rows.push(currentRow);
    } else {
      if (!currentRow || currentRow.moveNumber !== record.moveNumber) {
        currentRow = { moveNumber: record.moveNumber, black: record, blackIndex: index };
        rows.push(currentRow);
      } else {
        currentRow.black = record;
        currentRow.blackIndex = index;
      }
    }
  });

  return (
    <div className="w-full h-full bg-gray-900 rounded-lg border border-gray-700 flex flex-col overflow-hidden">
      <div className="p-3 bg-gray-800 border-b border-gray-700 font-semibold text-gray-200">
        Coups Joués
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center text-sm">
            <div className="w-8 text-center text-gray-500 font-mono select-none">
              {row.moveNumber}.
            </div>
            
            {/* White Move */}
            <div 
              className={`flex-1 flex items-center px-2 py-1 rounded cursor-pointer transition-colors ${activeIndex === row.whiteIndex ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
              onClick={() => row.whiteIndex !== undefined && onNodeClick?.(row.whiteIndex)}
            >
              <span className="font-semibold text-gray-200">{row.white?.san}</span>
              {row.white && row.white.classification !== 'good' && (
                <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold text-gray-900 ${getBadgeColor(row.white.classification)}`}>
                  {getBadgeText(row.white.classification)}
                </span>
              )}
            </div>

            {/* Black Move */}
            {row.black ? (
              <div 
                className={`flex-1 flex items-center px-2 py-1 rounded cursor-pointer transition-colors ${activeIndex === row.blackIndex ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
                onClick={() => row.blackIndex !== undefined && onNodeClick?.(row.blackIndex)}
              >
                <span className="font-semibold text-gray-200">{row.black.san}</span>
                {row.black.classification !== 'good' && (
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold text-gray-900 ${getBadgeColor(row.black.classification)}`}>
                    {getBadgeText(row.black.classification)}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex-1 px-2 py-1"></div>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="text-center text-gray-500 mt-4 text-sm">
            En attente de coups...
          </div>
        )}
      </div>
    </div>
  );
};
