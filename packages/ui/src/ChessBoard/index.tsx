"use client";
import React, { useMemo } from 'react';
import Chessground from 'react-chessground';
import 'react-chessground/dist/styles/chessground.css';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';
import type { Key, Color } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';

export interface ChessBoardProps {
  fen: string;
  onMove?: (from: string, to: string) => void;
  orientation?: 'white' | 'black';
  lastMove?: [string, string];
  shapes?: Array<{ orig: string; dest?: string; brush: string }>;
}

function getLegalDests(fen: string): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  try {
    const parsed = parseFen(fen).unwrap();
    const pos = Chess.fromSetup(parsed).unwrap();
    for (let sq = 0; sq < 64; sq++) {
      const piece = pos.board.get(sq);
      if (!piece || piece.color !== pos.turn) continue;
      const file = String.fromCharCode(97 + (sq % 8));
      const rank = Math.floor(sq / 8) + 1;
      const from = `${file}${rank}` as Key;
      const targets: Key[] = [];
      for (let to = 0; to < 64; to++) {
        const toFile = String.fromCharCode(97 + (to % 8));
        const toRank = Math.floor(to / 8) + 1;
        const toSq = `${toFile}${toRank}` as Key;
        const move = parseUci(`${from}${toSq}`);
        if (move && pos.isLegal(move) && !targets.includes(toSq)) {
          targets.push(toSq);
        }
        if (piece.role === 'pawn') {
          const promoMove = parseUci(`${from}${toSq}q`);
          if (promoMove && pos.isLegal(promoMove) && !targets.includes(toSq)) {
            targets.push(toSq);
          }
        }
      }
      if (targets.length > 0) dests.set(from, targets);
    }
  } catch { /* ignore parse errors */ }
  return dests;
}

export const ChessBoard: React.FC<ChessBoardProps> = ({
  fen,
  onMove,
  orientation,
  lastMove,
  shapes = [],
}) => {
  const { dests, isCheck } = useMemo(() => {
    let check = false;
    try {
      const parsed = parseFen(fen).unwrap();
      const pos = Chess.fromSetup(parsed).unwrap();
      check = pos.isCheck();
    } catch {}
    return { dests: getLegalDests(fen), isCheck: check };
  }, [fen]);

  const turn: Color = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const effectiveOrientation: "white" | "black" = orientation ?? turn;
  const lastMoveKeys: Key[] | undefined = lastMove
    ? [lastMove[0] as Key, lastMove[1] as Key]
    : undefined;
  const drawShapes: DrawShape[] = shapes.map(s => ({
    orig: s.orig as Key,
    dest: s.dest as Key | undefined,
    brush: s.brush,
  }));

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
      />
    </div>
  );
};
