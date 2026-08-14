'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ChessBoard, EvalGraph, EvalBar, MoveList } from '@chess-analyzer/ui';
import { GameManager, GameEventBus, EngineManager, MoveManager, MoveRecord, EvalNormalizer, MotifEngine } from '@chess-analyzer/chess-core';
import { EngineEvaluation } from '@chess-analyzer/chess-core/src/events/GameEventBus';
import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';

export default function Home() {
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [dests, setDests] = useState<Map<string, string[]>>(new Map());
  const [records, setRecords] = useState<MoveRecord[]>([]);
  const [currentWinProb, setCurrentWinProb] = useState<number>(0);
  const [currentCp, setCurrentCp] = useState<number | undefined>(0);
  const [currentMate, setCurrentMate] = useState<number | undefined>(undefined);
  const [shapes, setShapes] = useState<Array<{ orig: string; dest?: string; brush: string }>>([]);
  const multiPvs = useRef<Map<number, EngineEvaluation>>(new Map());
  const gmRef = useRef<GameManager | null>(null);

  useEffect(() => {
    const gm = new GameManager();
    const eventBus = gm.eventBus;
    
    gmRef.current = gm;
    gm.init();

    eventBus.on('PositionChanged', ({ fen }) => {
      setFen(fen);
    });

    eventBus.on('LegalMovesUpdated' as keyof GameEvents, ({ dests: newDests }: any) => {
      setDests(newDests);
    });

    eventBus.on('PedagogyUpdated', (record) => {
      setRecords(gm.getMoveRecords());
    });

    eventBus.on('EngineEvaluationUpdated', (evaluation) => {
      multiPvs.current.set(evaluation.multiPv || 1, evaluation);

      // We only update the main eval when we receive the primary PV (multipv 1)
      if (!evaluation.multiPv || evaluation.multiPv === 1) {
        const normCp = EvalNormalizer.normalize(evaluation.cp, evaluation.mate);
        setCurrentWinProb(EvalNormalizer.cpToWinningChances(normCp));
        setCurrentCp(evaluation.cp);
        setCurrentMate(evaluation.mate);
      }

      // Recompute all shapes
      const newShapes: Array<{ orig: string; dest?: string; brush: string }> = [];

      // 1. Draw MultiPV arrows
      const pv1 = multiPvs.current.get(1);
      const pv2 = multiPvs.current.get(2);
      const pv3 = multiPvs.current.get(3);

      if (pv3 && pv3.pv.length > 0) {
        newShapes.push({ orig: pv3.pv[0].substring(0, 2), dest: pv3.pv[0].substring(2, 4), brush: 'paleBlue' });
      }
      if (pv2 && pv2.pv.length > 0) {
        newShapes.push({ orig: pv2.pv[0].substring(0, 2), dest: pv2.pv[0].substring(2, 4), brush: 'paleBlue' });
      }
      // Best move on top (green)
      if (pv1 && pv1.pv.length > 0) {
        newShapes.push({ orig: pv1.pv[0].substring(0, 2), dest: pv1.pv[0].substring(2, 4), brush: 'paleGreen' });
      }

      // 2. Motif Engine
      try {
        const fenStr = gmRef.current ? gmRef.current['moveManager'].getFen() : 'start';
        const parsed = parseFen(fenStr).unwrap();
        const pos = Chess.fromSetup(parsed).unwrap();
        const board = pos.board;
        const epSquare = pos.epSquare;
        const castlingRights = pos.castlingRights || pos.rules?.castlingRights || new Set();

        const undefended = MotifEngine.detectUndefended(board, epSquare);
        undefended.forEach(u => {
          const file = String.fromCharCode(97 + (u.square % 8));
          const rank = Math.floor(u.square / 8) + 1;
          newShapes.push({ orig: `${file}${rank}`, brush: 'red' });
        });

        const pins = MotifEngine.detectPins(board);
        pins.forEach(p => {
          const file = String.fromCharCode(97 + (p.pinned % 8));
          const rank = Math.floor(p.pinned / 8) + 1;
          newShapes.push({ orig: `${file}${rank}`, brush: 'blue' });
        });
      } catch (e) {
        // silently ignore parse errors during fast updates
      }

      setShapes(newShapes);
    });

    eventBus.on('PositionChanged', ({ fen }) => {
      multiPvs.current.clear();
      setFen(fen);
    });

    return () => {
      gm.terminate();
    };
  }, []);

  const handleMove = useCallback((from: string, to: string) => {
    gmRef.current?.playMove(`${from}${to}`);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center p-8 bg-gray-950 text-white">
      <div className="flex gap-6 max-w-[1200px] w-full justify-center">
        
        {/* Left Col: EvalBar + Board */}
        <div className="flex flex-col gap-4">
          <div className="flex gap-4 h-[600px]">
            <EvalBar winProb={currentWinProb} cp={currentCp} mate={currentMate} />
            <div className="w-[600px] h-[600px] shadow-2xl rounded-lg overflow-hidden border border-gray-800">
              <ChessBoard
                fen={fen}
                onMove={handleMove}
                shapes={shapes}
              />
            </div>
          </div>
          {/* EvalGraph below board */}
          <div className="w-[648px] h-[150px] shadow-2xl rounded-lg overflow-hidden border border-gray-800 p-2 bg-gray-900">
            <EvalGraph records={records} />
          </div>
        </div>

        {/* Right Col: MoveList */}
        <div className="w-[300px] h-[766px] shadow-2xl">
          <MoveList records={records} />
        </div>

      </div>
    </main>
  );
}
