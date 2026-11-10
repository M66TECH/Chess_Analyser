"use client";
import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChessQueen,
  faChessRook,
  faChessBishop,
  faChessKnight,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

export interface PromotionDialogProps {
  from: string;
  to: string;
  color: 'white' | 'black';
  onSelect: (piece: 'q' | 'r' | 'b' | 'n') => void;
  onCancel: () => void;
}

const PIECES: Array<{ piece: 'q' | 'r' | 'b' | 'n'; icon: IconDefinition; label: string }> = [
  { piece: 'q', icon: faChessQueen, label: 'Dame' },
  { piece: 'r', icon: faChessRook, label: 'Tour' },
  { piece: 'b', icon: faChessBishop, label: 'Fou' },
  { piece: 'n', icon: faChessKnight, label: 'Cavalier' },
];

export const PromotionDialog: React.FC<PromotionDialogProps> = ({ color, onSelect, onCancel }) => {
  const pieceColor = color === 'white' ? 'text-white' : 'text-slate-900';
  const bgColor = color === 'white' ? 'bg-slate-100' : 'bg-slate-800';

  return (
    <div
      className="fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="glass-panel rounded-2xl p-6 max-w-sm w-full"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Choisir la pièce de promotion"
      >
        <h2 className="text-sm font-semibold text-slate-300 mb-4 text-center">Promotion : choisissez une pièce</h2>
        <div className="grid grid-cols-4 gap-3">
          {PIECES.map(({ piece, icon, label }) => (
            <button
              key={piece}
              onClick={() => onSelect(piece)}
              className={`flex flex-col items-center gap-2 p-3 rounded-xl border border-slate-600/50 hover:border-indigo-500 hover:bg-indigo-500/10 transition-colors ${bgColor}`}
              aria-label={label}
              title={label}
            >
              <FontAwesomeIcon icon={icon} className={`text-3xl ${pieceColor}`} />
              <span className="text-[10px] text-slate-500 font-medium">{label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onCancel}
          className="mt-4 w-full px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm text-slate-400 hover:text-white transition-colors border border-slate-700/50"
        >
          Annuler
        </button>
      </div>
    </div>
  );
};
