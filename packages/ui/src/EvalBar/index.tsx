import React from 'react';

export interface EvalBarProps {
  cp?: number;
  mate?: number;
  orientation?: 'white' | 'black';
}

export const EvalBar: React.FC<EvalBarProps> = ({ cp = 0, mate, orientation = 'white' }) => {
  // Calculation of percentage (0 = white winning, 100 = black winning)
  // For cp: usually +100 is 1 pawn advantage for white.
  // We can clamp between -1000 and +1000 cp.
  let whiteScore = 50; // 50% means equal
  
  if (mate !== undefined) {
    if (mate > 0) whiteScore = 100; // White mates
    else if (mate < 0) whiteScore = 0; // Black mates
  } else {
    // Basic scaling for cp: 
    // +100 cp -> 55% white, +500 cp -> 75% white, +1000 cp -> 90% white
    // A simple formula: 50 + (cp / 20) clamped to 0-100
    whiteScore = 50 + (cp / 20);
    whiteScore = Math.max(0, Math.min(100, whiteScore));
  }

  // Reverse if orientation is black
  const displayScore = orientation === 'white' ? whiteScore : 100 - whiteScore;
  const blackScore = 100 - displayScore;

  return (
    <div className="flex flex-col h-full w-8 bg-slate-800 rounded-sm overflow-hidden border border-slate-700 relative">
      {/* Black's portion (top if white orientation) */}
      <div 
        className="w-full bg-slate-900 transition-all duration-300 ease-in-out" 
        style={{ height: `${blackScore}%` }}
      />
      {/* White's portion (bottom if white orientation) */}
      <div 
        className="w-full bg-slate-100 transition-all duration-300 ease-in-out" 
        style={{ height: `${displayScore}%` }}
      />
      
      {/* Display text */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-[10px] font-bold mix-blend-difference text-white">
        {mate !== undefined ? `M${Math.abs(mate)}` : (cp > 0 ? '+' : '') + (cp / 100).toFixed(1)}
      </div>
    </div>
  );
};
