import React from 'react';

interface EvalBarProps {
  winProb: number; // between -1 (Black winning) and 1 (White winning)
  cp?: number;     // for display
  mate?: number;   // for display
}

export const EvalBar: React.FC<EvalBarProps> = ({ winProb, cp, mate }) => {
  // Map winProb [-1, 1] to a percentage [0, 100] for White's height
  // winProb = 1 -> 100% white
  // winProb = -1 -> 0% white
  // winProb = 0 -> 50% white
  const whitePercentage = ((winProb + 1) / 2) * 100;

  // Format the text to display
  let text = '';
  if (mate !== undefined && mate !== 0) {
    text = `M${Math.abs(mate)}`;
  } else if (cp !== undefined) {
    text = (cp > 0 ? '+' : '') + (cp / 100).toFixed(1);
  } else {
    text = '0.0';
  }

  // Determine where to place the text (top if white is low, bottom if white is high)
  const isWhiteWinning = winProb >= 0;

  return (
    <div className="relative w-8 h-full bg-gray-800 rounded-lg overflow-hidden border border-gray-700 flex flex-col justify-end">
      {/* Black Area (Implicit by background or fill) */}
      <div className="absolute top-0 w-full bg-gray-800" style={{ height: '100%' }}></div>
      
      {/* White Area */}
      <div 
        className="absolute bottom-0 w-full bg-gray-100 transition-all duration-500 ease-out" 
        style={{ height: `${whitePercentage}%` }}
      ></div>

      {/* Evaluation Text */}
      <div className={`absolute w-full text-center text-xs font-semibold py-1 z-10 ${isWhiteWinning ? 'bottom-0 text-black' : 'top-0 text-white'}`}>
        {text}
      </div>
    </div>
  );
};
