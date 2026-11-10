"use client";
import React, { useMemo, useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { chessgroundDests } from 'chessops/compat';
import type { Key, Color } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

export interface ChessBoardProps {
  fen: string;
  onMove?: (from: string, to: string) => void;
  orientation?: 'white' | 'black';
  lastMove?: [string, string];
  shapes?: Array<{ orig: string; dest?: string; brush: string }>;
  autoShapes?: Array<{ orig: string; dest?: string; brush: string }>;
  /**
   * `false` = plateau en lecture seule (démonstration, prévisualisation).
   * Par défaut interactif.
   */
  interactive?: boolean;
}

function computeBoardState(fen: string): { dests: Map<Key, Key[]>; isCheck: boolean } {
  const dests = new Map<Key, Key[]>();
  let isCheck = false;
  try {
    const parsed = parseFen(fen).unwrap();
    const pos = Chess.fromSetup(parsed).unwrap();
    isCheck = pos.isCheck();
    for (const [from, tos] of chessgroundDests(pos)) {
      dests.set(from as Key, tos as Key[]);
    }
  } catch {
    /* position illisible : échiquier figé plutôt que crash */
  }
  return { dests, isCheck };
}

const LICHESS_BRUSHES = {
  green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
  red: { key: 'r', color: '#e11d48', opacity: 1, lineWidth: 10 },
  blue: { key: 'b', color: '#2563eb', opacity: 1, lineWidth: 10 },
  yellow: { key: 'y', color: '#eab308', opacity: 1, lineWidth: 10 },
  paleBlue: { key: 'pb', color: '#0284c7', opacity: 0.7, lineWidth: 8 },
  paleGreen: { key: 'pg', color: '#16a34a', opacity: 0.7, lineWidth: 8 },
  paleRed: { key: 'pr', color: '#dc2626', opacity: 0.7, lineWidth: 8 },
  paleGrey: { key: 'pgr', color: '#64748b', opacity: 0.6, lineWidth: 7 },
  purple: { key: 'purple', color: '#9333ea', opacity: 0.85, lineWidth: 10 },
};

export const ChessBoard: React.FC<ChessBoardProps> = ({
  fen,
  onMove,
  orientation,
  lastMove,
  shapes = [],
  autoShapes = [],
  interactive = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cgRef = useRef<Api | null>(null);

  const { dests, isCheck } = useMemo(() => computeBoardState(fen), [fen]);

  const turn: Color = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const effectiveOrientation: 'white' | 'black' = orientation ?? turn;

  const lastMoveKeys: Key[] | undefined = useMemo(
    () => (lastMove ? [lastMove[0] as Key, lastMove[1] as Key] : undefined),
    [lastMove]
  );

  const drawShapes: DrawShape[] = useMemo(
    () =>
      shapes.map((s) => ({
        orig: s.orig as Key,
        dest: s.dest as Key | undefined,
        brush: s.brush,
      })),
    [shapes]
  );

  const autoDrawShapes: DrawShape[] = useMemo(
    () =>
      autoShapes.map((s) => ({
        orig: s.orig as Key,
        dest: s.dest as Key | undefined,
        brush: s.brush,
      })),
    [autoShapes]
  );

  const config: Config = useMemo(
    () => ({
      fen,
      orientation: effectiveOrientation,
      turnColor: turn,
      check: isCheck,
      lastMove: lastMoveKeys,
      coordinates: true,
      animation: { enabled: true, duration: 150 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      movable: {
        free: false,
        color: interactive ? 'both' : 'white',
        dests: interactive ? dests : new Map(),
        events: {
          after: interactive && onMove ? (orig, dest) => onMove(orig, dest) : undefined,
        },
      },
      drawable: {
        enabled: true,
        visible: true,
        shapes: drawShapes,
        autoShapes: autoDrawShapes,
        brushes: LICHESS_BRUSHES,
        defaultSnapToValidMove: true,
      },
    }),
    [
      fen,
      effectiveOrientation,
      turn,
      isCheck,
      lastMoveKeys,
      interactive,
      dests,
      onMove,
      drawShapes,
      autoDrawShapes,
    ]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    if (!cgRef.current) {
      cgRef.current = Chessground(containerRef.current, config);
    } else {
      cgRef.current.set(config);
    }
  }, [config]);

  useEffect(() => {
    return () => {
      cgRef.current?.destroy();
      cgRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ width: '100%', height: '100%' }}
    />
  );
};
