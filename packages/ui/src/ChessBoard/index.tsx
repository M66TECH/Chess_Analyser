"use client";
import React, { useMemo } from 'react';
import Chessground from 'react-chessground';
import 'react-chessground/dist/styles/chessground.css';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { chessgroundDests } from 'chessops/compat';
import type { Key, Color } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';

export interface ChessBoardProps {
  fen: string;
  onMove?: (from: string, to: string) => void;
  orientation?: 'white' | 'black';
  lastMove?: [string, string];
  shapes?: Array<{ orig: string; dest?: string; brush: string }>;
}

function computeBoardState(fen: string): { dests: Map<Key, Key[]>; isCheck: boolean } {
  const dests = new Map<Key, Key[]>();
  let isCheck = false;
  try {
    const parsed = parseFen(fen).unwrap();
    const pos = Chess.fromSetup(parsed).unwrap();
    isCheck = pos.isCheck();
    // chessops' official chessground adapter: castling, promotions and en passant
    // are handled correctly and cheaply (no 64x64 legality probes).
    for (const [from, tos] of chessgroundDests(pos)) {
      dests.set(from as Key, tos as Key[]);
    }
  } catch {
    /* position illisible : échiquier figé plutôt que crash */
  }
  return { dests, isCheck };
}

export const ChessBoard: React.FC<ChessBoardProps> = ({
  fen,
  onMove,
  orientation,
  lastMove,
  shapes = [],
}) => {
  const { dests, isCheck } = useMemo(() => computeBoardState(fen), [fen]);

  const turn: Color = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const effectiveOrientation: 'white' | 'black' = orientation ?? turn;
  // Tableau mémorisé : `lastMove` est recréé à chaque rendu sinon, et
  // chessground reçoit une nouvelle prop (animation/re-render inutiles).
  const lastMoveKeys: Key[] | undefined = useMemo(
    () => (lastMove ? [lastMove[0] as Key, lastMove[1] as Key] : undefined),
    [lastMove]
  );
  const drawShapes: DrawShape[] = useMemo(
    () =>
      shapes.map(s => ({
        orig: s.orig as Key,
        dest: s.dest as Key | undefined,
        brush: s.brush,
      })),
    [shapes]
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Chessground
        width="100%"
        height="100%"
        fen={fen}
        onMove={onMove}
        orientation={effectiveOrientation}
        turnColor={turn}
        movable={{
          free: false,
          color: 'both',
          dests,
        }}
        lastMove={lastMoveKeys}
        drawable={{ enabled: true, visible: true, shapes: drawShapes }}
        animation={{ enabled: true, duration: 150 }}
        highlight={{ lastMove: true, check: true }}
        check={isCheck}
        premovable={{ enabled: false }}
        coordinates={true}
      />
    </div>
  );
};
