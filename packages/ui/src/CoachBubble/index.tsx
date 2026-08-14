import React from 'react';
import type { MoveRecord } from '@chess-analyzer/chess-core';

export interface CoachBubbleProps {
  record?: MoveRecord;
}

export const CoachBubble: React.FC<CoachBubbleProps> = ({ record }) => {
  if (!record) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 shadow-xl text-white w-full h-[120px] flex items-center justify-center text-sm text-gray-500">
        Le coach Llama 3 est prêt à commenter vos coups.
      </div>
    );
  }

  const { explanation, classification, san, color, moveNumber } = record;
  const who = color === 'white' ? 'Blancs' : 'Noirs';

  // Couleurs dynamiques selon la classification
  let titleColor = 'text-gray-300';
  let badgeClass = 'bg-gray-800 border-gray-600';
  
  switch (classification) {
    case 'blunder':
      titleColor = 'text-red-500';
      badgeClass = 'bg-red-900/40 border-red-500 text-red-200';
      break;
    case 'mistake':
      titleColor = 'text-orange-500';
      badgeClass = 'bg-orange-900/40 border-orange-500 text-orange-200';
      break;
    case 'inaccuracy':
      titleColor = 'text-blue-400';
      badgeClass = 'bg-blue-900/40 border-blue-400 text-blue-200';
      break;
    case 'good':
      titleColor = 'text-green-400';
      badgeClass = 'bg-green-900/40 border-green-500 text-green-200';
      break;
    case 'excellent':
      titleColor = 'text-teal-400';
      badgeClass = 'bg-teal-900/40 border-teal-500 text-teal-200';
      break;
    case 'best':
    case 'great':
    case 'brilliant':
      titleColor = 'text-yellow-400';
      badgeClass = 'bg-yellow-900/40 border-yellow-500 text-yellow-200';
      break;
  }

  const formatClassification = (cls: string) => {
    switch (cls) {
      case 'blunder': return 'Gaffe';
      case 'mistake': return 'Erreur';
      case 'inaccuracy': return 'Imprécision';
      case 'good': return 'Bon';
      case 'excellent': return 'Excellent';
      case 'best': return 'Meilleur';
      case 'great': return 'Superbe';
      case 'brilliant': return 'Brillant';
      case 'book': return 'Livre';
      default: return 'Normal';
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 shadow-xl text-white w-full h-[120px] flex flex-col justify-between">
      <div className="flex justify-between items-center mb-2">
        <h3 className={`font-bold text-sm ${titleColor} flex items-center gap-2`}>
          <span>🤖</span> Coach Groq (Llama 3.3)
        </h3>
        <span className={`text-xs px-2 py-0.5 rounded border ${badgeClass}`}>
          {Math.floor(moveNumber)}{color === 'white' ? '.' : '...'} {san} — {formatClassification(classification)}
        </span>
      </div>
      
      <div className="text-sm flex-1 overflow-y-auto custom-scrollbar italic text-gray-300">
        {explanation ? (
          `« ${explanation} »`
        ) : (
          <span className="flex items-center gap-2 text-gray-500">
            <span className="animate-pulse">●</span> Analyse en cours...
          </span>
        )}
      </div>
    </div>
  );
};
