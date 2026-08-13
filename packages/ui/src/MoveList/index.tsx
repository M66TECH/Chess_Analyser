import React from 'react';
import { MoveRecord, MoveClassification } from '@chess-analyzer/chess-core';

export interface MoveListProps {
  moves: MoveRecord[];
  currentMoveIndex: number;
  onMoveClick: (index: number) => void;
}

const CLASS_CONFIG: Record<MoveClassification, { symbol: string; color: string; bg: string }> = {
  brilliant: { symbol: '!!', color: 'text-purple-300', bg: 'bg-purple-500/20 border-purple-500/40' },
  great:     { symbol: '!',  color: 'text-sky-300',    bg: 'bg-sky-500/20 border-sky-500/40' },
  best:      { symbol: '✓',  color: 'text-green-300',  bg: 'bg-green-500/20 border-green-500/40' },
  excellent: { symbol: '✓',  color: 'text-teal-300',   bg: 'bg-teal-500/20 border-teal-500/40' },
  good:      { symbol: '·',  color: 'text-slate-400',  bg: '' },
  inaccuracy:{ symbol: '?!', color: 'text-yellow-300', bg: 'bg-yellow-500/20 border-yellow-500/40' },
  mistake:   { symbol: '?',  color: 'text-orange-400', bg: 'bg-orange-500/20 border-orange-500/40' },
  blunder:   { symbol: '??', color: 'text-red-400',    bg: 'bg-red-500/20 border-red-500/40' },
  book:      { symbol: '📖', color: 'text-slate-400',  bg: '' },
};

export const MoveList: React.FC<MoveListProps> = ({ moves, currentMoveIndex, onMoveClick }) => {
  // Group moves by pair (white + black)
  const pairs: Array<{ white?: MoveRecord; black?: MoveRecord; number: number }> = [];
  let i = 0;
  while (i < moves.length) {
    const white = moves[i]?.color === 'white' ? moves[i] : undefined;
    const black = moves[i + 1]?.color === 'black' ? moves[i + 1] : undefined;
    pairs.push({ white, black, number: moves[i]?.moveNumber ?? Math.floor(i / 2) + 1 });
    i += 2;
  }

  const getGlobalIndex = (move: MoveRecord): number => {
    return moves.indexOf(move);
  };

  return (
    <div className="flex flex-col gap-0.5 font-mono text-sm leading-none">
      {pairs.map((pair, pi) => (
        <div key={pi} className="flex items-center gap-1">
          {/* Move number */}
          <span className="w-7 text-right text-slate-500 text-xs shrink-0 pr-1">
            {pair.number}.
          </span>

          {/* White move */}
          {pair.white ? (
            <MoveChip
              move={pair.white}
              isActive={getGlobalIndex(pair.white) === currentMoveIndex}
              onClick={() => onMoveClick(getGlobalIndex(pair.white!))}
            />
          ) : (
            <span className="flex-1" />
          )}

          {/* Black move */}
          {pair.black ? (
            <MoveChip
              move={pair.black}
              isActive={getGlobalIndex(pair.black) === currentMoveIndex}
              onClick={() => onMoveClick(getGlobalIndex(pair.black!))}
            />
          ) : (
            <span className="flex-1" />
          )}
        </div>
      ))}
      {moves.length === 0 && (
        <p className="text-slate-500 text-xs italic py-4 text-center">
          Jouez un coup pour commencer l'analyse…
        </p>
      )}
    </div>
  );
};

interface MoveChipProps {
  move: MoveRecord;
  isActive: boolean;
  onClick: () => void;
}

function MoveChip({ move, isActive, onClick }: MoveChipProps) {
  const cfg = CLASS_CONFIG[move.classification] ?? CLASS_CONFIG.good;
  return (
    <button
      onClick={onClick}
      title={move.explanation}
      className={`
        flex-1 flex items-center gap-1 px-1.5 py-1 rounded text-xs transition-all duration-150 border
        ${isActive
          ? 'bg-sky-500/30 border-sky-400/60 text-white shadow-sm shadow-sky-500/20'
          : cfg.bg
            ? `${cfg.bg} border text-slate-200 hover:brightness-125`
            : 'border-transparent text-slate-300 hover:bg-slate-700/50'
        }
      `}
    >
      <span className="font-semibold tracking-tight">{move.san}</span>
      {move.classification !== 'good' && move.classification !== 'book' && (
        <span className={`text-[10px] font-bold ${cfg.color} shrink-0`}>
          {cfg.symbol}
        </span>
      )}
    </button>
  );
}
