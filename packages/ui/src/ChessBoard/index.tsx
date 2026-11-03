"use client";
import React from 'react';
import Chessground from 'react-chessground';
import 'react-chessground/dist/styles/chessground.css';

export interface ChessBoardProps {
  fen: string;
  onMove?: (from: string, to: string) => void;
  orientation?: 'white' | 'black';
}

export const ChessBoard: React.FC<ChessBoardProps> = ({
  fen,
  onMove,
  orientation = 'white'
}) => {
  return (
    <div style={{ width: '100%', maxWidth: '600px', margin: '0 auto' }}>
      <Chessground
        fen={fen}
        onMove={onMove}
        orientation={orientation}
        animation={{ enabled: true }}
      />
    </div>
  );
};
