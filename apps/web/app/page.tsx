"use client";
import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { GameManager, HeatmapData, EngineEvaluation } from '@chess-analyzer/chess-core';
import { EvalBar, BoardOverlay, HeatmapLayer } from '@chess-analyzer/ui';

const ChessBoard = dynamic(
  () => import('@chess-analyzer/ui').then((mod) => mod.ChessBoard),
  { ssr: false, loading: () => <div className="h-full w-full min-h-[500px] flex items-center justify-center bg-slate-900/50 rounded-xl border border-slate-700/50 text-slate-400 animate-pulse">Chargement...</div> }
);

export default function Home() {
  const gameManagerRef = useRef<GameManager | null>(null);
  
  const [fen, setFen] = useState('start');
  const [heatmap, setHeatmap] = useState<HeatmapData>({});
  const [evaluation, setEvaluation] = useState<EngineEvaluation | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [isEngineReady, setIsEngineReady] = useState(false);

  useEffect(() => {
    if (!gameManagerRef.current) {
      const gm = new GameManager();
      gameManagerRef.current = gm;
      
      gm.eventBus.on('PositionChanged', (data) => setFen(data.fen));
      gm.eventBus.on('HeatmapUpdated', (data) => setHeatmap(data));
      gm.eventBus.on('EngineEvaluationUpdated', (data) => {
        setEvaluation(data);
        setIsEngineReady(true);
      });

      gm.init();
    }

    return () => {
      if (gameManagerRef.current) {
        gameManagerRef.current.engineManager.terminate();
      }
    };
  }, []);

  const handleMove = (from: string, to: string) => {
    if (gameManagerRef.current) {
      const uci = `${from}${to}`;
      gameManagerRef.current.playMove(uci);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] selection:bg-sky-500/30 overflow-hidden flex flex-col font-sans">
      
      {/* Navbar */}
      <header className="glass-panel border-b border-t-0 border-l-0 border-r-0 border-slate-700/50 px-6 py-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight">Chess<span className="text-gradient">Analyzer</span></h1>
        </div>
        <div className="flex items-center gap-4 text-sm font-medium">
          <button className="text-slate-400 hover:text-white transition-colors">Documentation</button>
          <button className="text-slate-400 hover:text-white transition-colors">Paramètres</button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        
        {/* Left Sidebar (Settings & Tools) */}
        <aside className="w-full lg:w-72 glass-panel border-r border-t-0 border-b-0 border-l-0 border-slate-700/50 p-6 flex flex-col gap-8 z-10 hidden lg:flex">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-4">Affichage</h3>
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative">
                <input 
                  type="checkbox" 
                  className="sr-only" 
                  checked={showHeatmap} 
                  onChange={(e) => setShowHeatmap(e.target.checked)} 
                />
                <div className={`block w-10 h-6 rounded-full transition-colors ${showHeatmap ? 'bg-sky-500' : 'bg-slate-700'}`}></div>
                <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${showHeatmap ? 'transform translate-x-4' : ''}`}></div>
              </div>
              <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Heatmap de Pression</span>
            </label>
          </div>
          
          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-4">Statut Moteur</h3>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isEngineReady ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)] animate-pulse' : 'bg-yellow-500'}`}></div>
              <span className="text-sm text-slate-300">
                {isEngineReady ? 'Stockfish 16.1 prêt' : 'Démarrage...'}
              </span>
            </div>
          </div>
        </aside>

        {/* Center (Board) */}
        <section className="flex-1 p-6 lg:p-10 flex items-center justify-center relative overflow-y-auto lg:overflow-hidden">
          {/* Subtle background glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-sky-500/10 rounded-full blur-[100px] pointer-events-none"></div>
          
          <div className="flex flex-row gap-4 h-full max-h-[750px] w-full max-w-[850px] relative z-10">
            {/* Eval Bar */}
            <div className="h-full flex-shrink-0 w-8 lg:w-10 pt-8">
              <div className="h-[calc(100%-2rem)]">
                 <EvalBar cp={evaluation?.cp} mate={evaluation?.mate} orientation="white" />
              </div>
            </div>
            
            {/* Board Container */}
            <div className="flex-1 flex flex-col justify-center">
              <div className="glass-panel p-2 rounded-xl border border-slate-700/50 glow-primary shadow-2xl relative w-full aspect-square max-h-full">
                <ChessBoard fen={fen} onMove={handleMove} orientation="white" />
                <BoardOverlay>
                  {showHeatmap && <HeatmapLayer data={heatmap} orientation="white" />}
                </BoardOverlay>
              </div>
            </div>
          </div>
        </section>

        {/* Right Sidebar (Analysis) */}
        <aside className="w-full lg:w-96 glass-panel border-l border-t-0 border-b-0 border-r-0 border-slate-700/50 flex flex-col z-10 overflow-hidden">
          <div className="p-6 border-b border-slate-700/50">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <svg className="w-5 h-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Analyse Moteur
            </h2>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
            
            {/* Score Card */}
            <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700/50 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-[40px] group-hover:bg-indigo-500/20 transition-colors"></div>
              <div className="text-sm text-slate-400 mb-1">Évaluation actuelle</div>
              <div className="text-4xl font-mono font-bold text-white tracking-tight flex items-baseline gap-2">
                {evaluation ? (
                  evaluation.mate !== undefined ? (
                    <span className="text-sky-400">M{Math.abs(evaluation.mate)}</span>
                  ) : (
                    <span className={evaluation.cp && evaluation.cp > 0 ? "text-white" : "text-slate-300"}>
                      {(evaluation.cp || 0) > 0 ? '+' : ''}{((evaluation.cp || 0) / 100).toFixed(2)}
                    </span>
                  )
                ) : (
                  <span className="text-slate-600 animate-pulse">0.00</span>
                )}
                <span className="text-xs text-slate-500 font-sans tracking-normal font-normal">
                  Profondeur {evaluation?.depth || 0}
                </span>
              </div>
            </div>

            {/* PV Lines */}
            <div>
              <h3 className="text-sm font-medium text-slate-300 mb-3">Meilleure ligne (PV)</h3>
              <div className="bg-slate-900/80 rounded-lg p-4 font-mono text-sm leading-relaxed border border-slate-700/30">
                {evaluation && evaluation.pv.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {evaluation.pv.slice(0, 10).map((move, i) => (
                      <span key={i} className="px-2 py-1 rounded bg-slate-800 text-sky-300 border border-slate-700/50">
                        {move}
                      </span>
                    ))}
                    {evaluation.pv.length > 10 && <span className="text-slate-500 px-1 py-1">...</span>}
                  </div>
                ) : (
                  <span className="text-slate-600 italic">En attente de calcul...</span>
                )}
              </div>
            </div>

          </div>
        </aside>
      </main>
    </div>
  );
}
