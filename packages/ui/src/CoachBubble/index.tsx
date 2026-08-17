import React from 'react';
import type { MoveRecord } from '@chess-analyzer/chess-core';
import ReactMarkdown from 'react-markdown';

export interface CoachBubbleProps {
  record?: MoveRecord;
}

export const CoachBubble: React.FC<CoachBubbleProps> = ({ record }) => {
  if (!record) {
    return (
      <div className="glass-panel rounded-xl p-6 w-full h-[300px] flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(99,102,241,0.3)]">
          <span className="text-3xl">🤖</span>
        </div>
        <h2 className="text-xl font-bold text-slate-200 mb-2">Coach IA prêt</h2>
        <p className="text-sm text-slate-400 max-w-sm">
          Le Grand Maître Llama 3 analysera vos coups avec une précision chirurgicale. Jouez un coup pour commencer !
        </p>
      </div>
    );
  }

  const { explanation, classification, san, color, moveNumber } = record;

  let badgeClass = 'bg-slate-800 border-slate-600';
  let glowClass = '';
  
  switch (classification) {
    case 'blunder':
      badgeClass = 'bg-red-500/20 border-red-500/50 text-red-200';
      glowClass = 'shadow-[0_0_15px_rgba(239,68,68,0.3)]';
      break;
    case 'mistake':
      badgeClass = 'bg-orange-500/20 border-orange-500/50 text-orange-200';
      glowClass = 'shadow-[0_0_15px_rgba(249,115,22,0.3)]';
      break;
    case 'inaccuracy':
      badgeClass = 'bg-yellow-400/20 border-yellow-400/50 text-yellow-200';
      glowClass = 'shadow-[0_0_15px_rgba(250,204,21,0.3)]';
      break;
    case 'good':
      badgeClass = 'bg-green-500/20 border-green-500/50 text-green-200';
      break;
    case 'excellent':
      badgeClass = 'bg-teal-400/20 border-teal-400/50 text-teal-200';
      break;
    case 'best':
    case 'great':
    case 'brilliant':
      badgeClass = 'bg-indigo-500/30 border-indigo-500/50 text-indigo-200';
      glowClass = 'shadow-[0_0_20px_rgba(99,102,241,0.4)]';
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
    <div className="glass-panel rounded-xl p-0 w-full h-[400px] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900/80 px-5 py-4 border-b border-slate-700/50 flex justify-between items-center backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-500/20 rounded-full flex items-center justify-center shadow-lg border border-indigo-500/30">
            <span className="text-xl">🤖</span>
          </div>
          <div>
            <h3 className="font-bold text-slate-100 leading-tight">Coach Llama 3</h3>
            <span className="text-xs text-indigo-300">Grand Maître IA</span>
          </div>
        </div>
        
        <div className={'flex flex-col items-end'}>
          <span className="text-xs text-slate-400 mb-1">Coup joué : {Math.floor(moveNumber)}{color === 'white' ? '.' : '...'} {san}</span>
          <span className={`text-xs px-2.5 py-1 rounded-md border font-bold uppercase tracking-wider ${badgeClass} ${glowClass}`}>
            {formatClassification(classification)}
          </span>
        </div>
      </div>
      
      {/* Scrollable Content */}
      <div className="p-5 flex-1 overflow-y-auto custom-scrollbar">
        {explanation ? (
          <div className="text-slate-300 text-sm leading-relaxed prose prose-invert prose-headings:text-indigo-300 prose-h2:text-base prose-h2:mb-2 prose-h2:mt-4 prose-p:mb-4 max-w-none">
            <ReactMarkdown>{explanation}</ReactMarkdown>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <span className="animate-pulse text-sm">Le Coach réfléchit profondément...</span>
          </div>
        )}
      </div>
    </div>
  );
};
