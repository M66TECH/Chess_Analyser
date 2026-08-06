"use client";
import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { GameManager, HeatmapData, EngineEvaluation } from '@chess-analyzer/chess-core';
import { EvalBar, BoardOverlay, HeatmapLayer } from '@chess-analyzer/ui';

const ChessBoard = dynamic(
  () => import('@chess-analyzer/ui').then((mod) => mod.ChessBoard),
  { ssr: false, loading: () => <div className="h-[600px] w-full flex items-center justify-center bg-slate-900 rounded border border-slate-700 text-slate-400">Chargement de l'échiquier...</div> }
);

export default function Home() {
  const gameManagerRef = useRef<GameManager | null>(null);
  
  const [fen, setFen] = useState('start');
  const [heatmap, setHeatmap] = useState<HeatmapData>({});
  const [evaluation, setEvaluation] = useState<EngineEvaluation | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(true);

  useEffect(() => {
    if (!gameManagerRef.current) {
      const gm = new GameManager();
      gameManagerRef.current = gm;
      
      gm.eventBus.on('PositionChanged', (data) => setFen(data.fen));
      gm.eventBus.on('HeatmapUpdated', (data) => setHeatmap(data));
      gm.eventBus.on('EngineEvaluationUpdated', (data) => setEvaluation(data));

      gm.init();
    }

    return () => {
      // Cleanup
      if (gameManagerRef.current) {
        gameManagerRef.current.engineManager.terminate();
      }
    };
  }, []);

  const handleMove = (from: string, to: string) => {
    if (gameManagerRef.current) {
      // Very basic uci format (doesn't handle promotion strictly yet, defaults to q)
      const uci = `${from}${to}`;
      // In a real app we'd need to detect if it's a promotion and append 'q'
      gameManagerRef.current.playMove(uci);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-8">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold mb-2">Next-Gen Chess Analyzer</h1>
        <p className="text-slate-400">Pipeline d'analyse avancé avec calques SVG</p>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        <div className="lg:col-span-3 flex flex-row gap-4">
          <div className="h-[600px] flex-shrink-0">
            <EvalBar cp={evaluation?.cp} mate={evaluation?.mate} orientation="white" />
          </div>
          
          <div className="bg-slate-800 p-6 rounded-xl shadow-2xl border border-slate-700 relative w-full flex items-center justify-center max-w-[600px]">
            <div className="relative w-full aspect-square">
              <ChessBoard fen={fen} onMove={handleMove} orientation="white" />
              <BoardOverlay>
                {showHeatmap && <HeatmapLayer data={heatmap} orientation="white" />}
              </BoardOverlay>
            </div>
          </div>
        </div>
        
        <div className="bg-slate-800 p-6 rounded-xl shadow-xl border border-slate-700 flex flex-col space-y-4">
          <h2 className="text-2xl font-semibold">Analyse</h2>
          <div className="flex-1 bg-slate-900 rounded p-4 text-sm font-mono text-slate-300 overflow-y-auto">
            {evaluation ? (
              <>
                <p>Profondeur : {evaluation.depth}</p>
                <p>Score : {evaluation.mate ? `M${evaluation.mate}` : `${(evaluation.cp || 0) / 100}`}</p>
                <p className="mt-2 text-blue-400 text-xs">PV : {evaluation.pv.join(' ')}</p>
              </>
            ) : (
              <p>Analyse en cours...</p>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <input 
              type="checkbox" 
              id="heatmap-toggle" 
              checked={showHeatmap} 
              onChange={(e) => setShowHeatmap(e.target.checked)} 
            />
            <label htmlFor="heatmap-toggle">Afficher la Heatmap de contrôle</label>
          </div>
        </div>
      </main>
    </div>
  );
}
