import React, { useEffect, useRef } from 'react';
import { MoveRecord, MoveClassification } from '@chess-analyzer/chess-core';

interface MoveListProps {
  records: MoveRecord[];
  activeIndex?: number;
  onNodeClick?: (index: number) => void;
}

const getBadgeColor = (classification: MoveClassification) => {
  switch (classification) {
    case 'blunder': return 'bg-red-500/20 text-red-400 border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]';
    case 'mistake': return 'bg-orange-500/20 text-orange-400 border-orange-500/50 shadow-[0_0_10px_rgba(249,115,22,0.2)]';
    case 'inaccuracy': return 'bg-yellow-400/20 text-yellow-300 border-yellow-400/50 shadow-[0_0_10px_rgba(250,204,21,0.2)]';
    case 'brilliant': return 'bg-teal-400/20 text-teal-300 border-teal-400/50 shadow-[0_0_10px_rgba(45,212,191,0.2)]';
    case 'great': return 'bg-blue-400/20 text-blue-300 border-blue-400/50 shadow-[0_0_10px_rgba(96,165,250,0.2)]';
    case 'best': return 'bg-green-500/20 text-green-400 border-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.2)]';
    case 'excellent': return 'bg-green-400/20 text-green-300 border-green-400/50 shadow-[0_0_10px_rgba(74,222,128,0.2)]';
    case 'book': return 'bg-purple-400/20 text-purple-300 border-purple-400/50 shadow-[0_0_10px_rgba(192,132,252,0.2)]';
    default: return 'bg-transparent border-transparent';
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
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Group records by move number
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

  // Auto-scroll to active move
  useEffect(() => {
    if (containerRef.current) {
      const activeEl = containerRef.current.querySelector('.active-move');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeIndex, records]);

  return (
    <div className="w-full h-full glass-panel rounded-xl flex flex-col overflow-hidden">
      <div className="px-4 py-3 bg-slate-900/80 border-b border-slate-700/50 flex justify-between items-center backdrop-blur-md">
        <h3 className="font-semibold text-slate-100 flex items-center gap-2">
          <span className="text-indigo-400">📝</span> Coups Joués
        </h3>
        <span className="text-xs text-slate-400">{records.length} coups</span>
      </div>
      
      <div ref={containerRef} className="flex-1 overflow-y-auto custom-scrollbar p-2">
        <div className="grid grid-cols-[3rem_1fr_1fr] gap-x-2 gap-y-1 text-sm font-medium">
          {/* Header */}
          <div className="text-center text-xs text-slate-500 py-1 font-semibold uppercase tracking-wider">N°</div>
          <div className="text-xs text-slate-500 py-1 font-semibold uppercase tracking-wider pl-2">Blancs</div>
          <div className="text-xs text-slate-500 py-1 font-semibold uppercase tracking-wider pl-2">Noirs</div>
          
          {rows.map((row, i) => (
            <React.Fragment key={i}>
              <div className="flex items-center justify-center text-slate-500 font-mono text-xs opacity-70">
                {row.moveNumber}
              </div>
              
              {/* White Move */}
              <div 
                className={`flex items-center justify-between px-3 py-1.5 rounded-md cursor-pointer transition-all duration-200 border border-transparent
                  ${activeIndex === row.whiteIndex 
                    ? 'active-move bg-indigo-500/20 border-indigo-500/30 text-indigo-100 shadow-[inset_0_0_12px_rgba(99,102,241,0.1)]' 
                    : 'hover:bg-slate-800/60 text-slate-300'}`}
                onClick={() => row.whiteIndex !== undefined && onNodeClick?.(row.whiteIndex)}
              >
                <span>{row.white?.san}</span>
                {row.white && row.white.classification !== 'good' && row.white.classification !== 'book' && (
                  <span className={`ml-2 px-1.5 py-0.5 rounded border text-[10px] font-bold ${getBadgeColor(row.white.classification)}`}>
                    {getBadgeText(row.white.classification)}
                  </span>
                )}
              </div>

              {/* Black Move */}
              {row.black ? (
                <div 
                  className={`flex items-center justify-between px-3 py-1.5 rounded-md cursor-pointer transition-all duration-200 border border-transparent
                    ${activeIndex === row.blackIndex 
                      ? 'active-move bg-indigo-500/20 border-indigo-500/30 text-indigo-100 shadow-[inset_0_0_12px_rgba(99,102,241,0.1)]' 
                      : 'hover:bg-slate-800/60 text-slate-300'}`}
                  onClick={() => row.blackIndex !== undefined && onNodeClick?.(row.blackIndex)}
                >
                  <span>{row.black.san}</span>
                  {row.black.classification !== 'good' && row.black.classification !== 'book' && (
                    <span className={`ml-2 px-1.5 py-0.5 rounded border text-[10px] font-bold ${getBadgeColor(row.black.classification)}`}>
                      {getBadgeText(row.black.classification)}
                    </span>
                  )}
                </div>
              ) : (
                <div className="px-3 py-1.5"></div>
              )}
            </React.Fragment>
          ))}
        </div>
        
        {rows.length === 0 && (
          <div className="h-full flex items-center justify-center text-slate-500 text-sm italic">
            La partie n'a pas encore commencé...
          </div>
        )}
      </div>
    </div>
  );
};
