import React from 'react';

export interface EvalBarProps {
  cp?: number;
  mate?: number;
  orientation?: 'white' | 'black';
}

export const EvalBar: React.FC<EvalBarProps> = ({ cp = 0, mate, orientation = 'white' }) => {
  let whiteScore = 50;
  
  if (mate !== undefined) {
    if (mate > 0) whiteScore = 100;
    else if (mate < 0) whiteScore = 0;
  } else {
    // Non-linear scaling for cp to make small differences visible but cap at huge differences
    // Use a sigmoid-like or simple clamping
    whiteScore = 50 + (cp / 20);
    whiteScore = Math.max(0, Math.min(100, whiteScore));
  }

  const displayScore = orientation === 'white' ? whiteScore : 100 - whiteScore;
  const blackScore = 100 - displayScore;

  return (
    <div className="flex flex-col h-full w-full bg-slate-900 rounded-lg overflow-hidden border border-slate-700/50 shadow-inner shadow-black/50 relative">
      {/* Black's portion */}
      <div 
        className="w-full bg-gradient-to-b from-slate-900 to-slate-800 transition-[height] duration-700 ease-out" 
        style={{ height: `${blackScore}%` }}
      />
      {/* White's portion */}
      <div 
        className="w-full bg-gradient-to-b from-slate-200 to-white transition-[height] duration-700 ease-out relative shadow-[0_-5px_15px_rgba(255,255,255,0.1)]" 
        style={{ height: `${displayScore}%` }}
      />
      
      {/* Display text */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-[11px] font-bold mix-blend-difference text-white select-none pointer-events-none drop-shadow-md">
        {mate !== undefined ? `M${Math.abs(mate)}` : (cp > 0 ? '+' : '') + (cp / 100).toFixed(1)}
      </div>
    </div>
  );
};
