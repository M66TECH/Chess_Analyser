'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ChessBoard, EvalGraph } from '@chess-analyzer/ui';
import { GameManager, GameEventBus, EngineManager, MoveManager, MoveRecord } from '@chess-analyzer/chess-core';

export default function Home() {
  const [fen, setFen] = useState('start');
  const [dests, setDests] = useState<Map<string, string[]>>(new Map());
  const [records, setRecords] = useState<MoveRecord[]>([]);
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

    return () => {
      gm.terminate();
    };
  }, []);

  const handleMove = useCallback((from: string, to: string) => {
    gmRef.current?.playMove(`${from}${to}`);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center p-8 bg-gray-950">
      <div className="flex flex-col gap-6">
        <div className="w-[600px] h-[600px] shadow-2xl rounded-lg overflow-hidden border border-gray-800">
          <ChessBoard
            fen={fen}
            dests={dests}
            onMove={handleMove}
          />
        </div>
        <div className="w-[600px] h-[150px] shadow-2xl rounded-lg overflow-hidden border border-gray-800 p-2 bg-gray-900">
          <EvalGraph records={records} />
        </div>
      </div>
    </main>
  );
}
