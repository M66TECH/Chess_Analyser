'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ChessBoard, EvalGraph, EvalBar, MoveList } from '@chess-analyzer/ui';
import { GameManager, GameEventBus, EngineManager, MoveManager, MoveRecord, EvalNormalizer } from '@chess-analyzer/chess-core';

export default function Home() {
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [dests, setDests] = useState<Map<string, string[]>>(new Map());
  const [records, setRecords] = useState<MoveRecord[]>([]);
  const [currentWinProb, setCurrentWinProb] = useState<number>(0);
  const [currentCp, setCurrentCp] = useState<number | undefined>(0);
  const [currentMate, setCurrentMate] = useState<number | undefined>(undefined);
  const [shapes, setShapes] = useState<Array<{ orig: string; dest?: string; brush: string }>>([]);
  const gmRef = useRef<GameManager | null>(null);

  useEffect(() => {
    const eventBus = new GameEventBus();
    const engineManager = new EngineManager(eventBus);
    const moveManager = new MoveManager();
    const gm = new GameManager(eventBus, moveManager, engineManager);

    gmRef.current = gm;
    gm.init();

    eventBus.on('PositionChanged', ({ fen }) => {
      setFen(fen);
    });

    eventBus.on('LegalMovesUpdated', ({ dests: newDests }) => {
      setDests(newDests);
    });

    eventBus.on('PedagogyUpdated', (record) => {
      setRecords(gm.getMoveRecords());
    });

    eventBus.on('EngineEvaluationUpdated', (evaluation) => {
      const normCp = EvalNormalizer.normalize(evaluation.cp, evaluation.mate);
      setCurrentWinProb(EvalNormalizer.cpToWinningChances(normCp));
      setCurrentCp(evaluation.cp);
      setCurrentMate(evaluation.mate);

      // Best move arrow
      if (evaluation.pv.length > 0) {
        const bestMove = evaluation.pv[0];
        if (bestMove && bestMove.length >= 4) {
          const orig = bestMove.substring(0, 2);
          const dest = bestMove.substring(2, 4);
          setShapes([{ orig, dest, brush: 'paleGreen' }]);
        }
      } else {
        setShapes([]);
      }
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
                dests={dests}
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
