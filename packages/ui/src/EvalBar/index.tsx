import React from 'react';

export interface EvalBarProps {
  cp?: number;
  mate?: number;
  orientation?: 'white' | 'black';
}

/**
 * Converts centipawns to win probability using the same sigmoid formula as MoveClassifier.
 * Ensures the EvalBar is visually consistent with the analysis engine.
 */
function cpToWinProb(cp: number): number {
  const clamped = Math.max(-10000, Math.min(10000, cp));
  return 1 / (1 + Math.exp(-0.00368208 * clamped));
}

export const EvalBar: React.FC<EvalBarProps> = ({ cp = 0, mate, orientation = 'white' }) => {
  let whiteWinProb: number;

  if (mate !== undefined) {
    whiteWinProb = mate > 0 ? 0.99 : 0.01;
  } else {
    whiteWinProb = cpToWinProb(cp);
  }

  const whitePercent = orientation === 'white'
    ? whiteWinProb * 100
    : (1 - whiteWinProb) * 100;
  const blackPercent = 100 - whitePercent;

  const displayScore = mate !== undefined
    ? `M${Math.abs(mate)}`
    : (cp > 0 ? '+' : '') + (cp / 100).toFixed(1);

  return (
    <div className="flex flex-col h-full w-full bg-slate-900 rounded-lg overflow-hidden border border-slate-700/50 shadow-inner shadow-black/50 relative">
      {/* Black's portion — top */}
      <div
        className="w-full transition-[height] duration-500 ease-out"
        style={{
          height: `${blackPercent}%`,
          background: 'linear-gradient(to bottom, #1e293b, #334155)',
        }}
      />
      {/* White's portion — bottom */}
      <div
        className="w-full transition-[height] duration-500 ease-out relative"
        style={{
          height: `${whitePercent}%`,
          background: 'linear-gradient(to bottom, #cbd5e1, #f8fafc)',
          boxShadow: '0 -3px 12px rgba(255,255,255,0.1)',
        }}
      />

      {/* Score label */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-[10px] font-bold mix-blend-difference text-white select-none pointer-events-none drop-shadow-md tracking-tight">
        {displayScore}
      </div>
    </div>
  );
};
