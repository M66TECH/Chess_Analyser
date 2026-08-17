'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { ChessBoard, EvalGraph, EvalBar, MoveList, GameReport, Explorer, KeyMoments, CoachBubble } from '@chess-analyzer/ui';
import { GameManager, MoveRecord, EvalNormalizer, MotifEngine, AccuracyScore, ExplorerService, ExplorerResult, PgnParser } from '@chess-analyzer/chess-core';
import { EngineEvaluation } from '@chess-analyzer/chess-core/src/events/GameEventBus';
import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';

export default function Home() {
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const initialFenRef = useRef(fen);
  const [records, setRecords] = useState<MoveRecord[]>([]);
  const [currentWinProb, setCurrentWinProb] = useState<number>(0);
  const [currentCp, setCurrentCp] = useState<number | undefined>(0);
  const [currentMate, setCurrentMate] = useState<number | undefined>(undefined);
  const [shapes, setShapes] = useState<Array<{ orig: string; dest?: string; brush: string }>>([]);
  const [showReport, setShowReport] = useState(false);
  const [threatMode, setThreatMode] = useState(false);
  const [explorerData, setExplorerData] = useState<ExplorerResult>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const multiPvs = useRef<Map<number, EngineEvaluation>>(new Map());
  const threatPvs = useRef<Map<number, EngineEvaluation>>(new Map());
  const gmRef = useRef<GameManager | null>(null);

  useEffect(() => {
    const gm = new GameManager();
    const eventBus = gm.eventBus;
    gmRef.current = gm;

    eventBus.on('PositionChanged', ({ fen }) => {
      setFen(fen);
    });

    eventBus.on('PedagogyUpdated', () => {
      setRecords(gm.getMoveRecords());
    });
    
    eventBus.on('MovePlayed', ({ nodeId }) => setActiveNodeId(nodeId));
    eventBus.on('NavigateTo', ({ nodeId }) => setActiveNodeId(nodeId));

    eventBus.on('EngineEvaluationUpdated', (evaluation) => {
      multiPvs.current.set(evaluation.multiPv || 1, evaluation);

      // We only update the main eval when we receive the primary PV (multipv 1)
      if (!evaluation.multiPv || evaluation.multiPv === 1) {
        const currentFen = gmRef.current ? gmRef.current['moveManager'].getFen() : initialFenRef.current;
        const turn = currentFen.split(' ')[1] === 'w' ? 'white' : 'black';
        const normCp = EvalNormalizer.normalize(evaluation.cp, evaluation.mate, turn);
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
      } catch {
        // silently ignore parse errors during fast updates
      }

      setShapes(newShapes);
    });

    eventBus.on('ThreatEvaluationUpdated', (evaluation) => {
      threatPvs.current.set(evaluation.multiPv || 1, evaluation);

      const newShapes: Array<{ orig: string; dest?: string; brush: string }> = [];
      const pv1 = threatPvs.current.get(1);
      const pv2 = threatPvs.current.get(2);
      const pv3 = threatPvs.current.get(3);

      if (pv3 && pv3.pv.length > 0) newShapes.push({ orig: pv3.pv[0].substring(0, 2), dest: pv3.pv[0].substring(2, 4), brush: 'paleRed' });
      if (pv2 && pv2.pv.length > 0) newShapes.push({ orig: pv2.pv[0].substring(0, 2), dest: pv2.pv[0].substring(2, 4), brush: 'paleRed' });
      if (pv1 && pv1.pv.length > 0) newShapes.push({ orig: pv1.pv[0].substring(0, 2), dest: pv1.pv[0].substring(2, 4), brush: 'red' });

      setShapes(newShapes);
    });

    eventBus.on('PositionChanged', ({ fen }) => {
      multiPvs.current.clear();
      threatPvs.current.clear();
      setThreatMode(false);
      setFen(fen);
      ExplorerService.fetch(fen).then(setExplorerData);
    });

    gm.init();

    return () => {
      gm.terminate();
    };
  }, []);

  const stats = useMemo(() => AccuracyScore.computeGameStats(records), [records]);
  const activeRecord = useMemo(() => records.find(r => r.nodeId === activeNodeId), [records, activeNodeId]);

  const handleNodeSelect = useCallback((nodeId: string) => {
    gmRef.current?.navigateToNode(nodeId);
  }, []);

  const handleMove = useCallback((from: string, to: string) => {
    gmRef.current?.playMove(`${from}${to}`);
  }, []);

  const toggleThreatMode = useCallback(() => {
    setThreatMode(prev => {
      const next = !prev;
      if (next) {
        setShapes([]);
        gmRef.current?.engineManager.analyzeThreat(fen);
      } else {
        gmRef.current?.engineManager.analyze(fen);
      }
      return next;
    });
  }, [fen]);

  const handleExportPgn = useCallback(() => {
    const pgnStr = PgnParser.exportAnnotatedPgn(records);
    const blob = new Blob([pgnStr], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chess_analysis.pgn';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [records]);

  const handleImportPgn = useCallback(() => {
    const pgn = window.prompt("Collez votre texte PGN ici :");
    if (pgn) {
      if (gmRef.current) {
        gmRef.current.loadPgn(pgn);
      }
    }
  }, []);

  return (
    <main className="min-h-screen w-full flex items-center justify-center p-4 xl:p-8">
      <div className="flex flex-col xl:flex-row gap-6 max-w-[1450px] w-full items-start justify-center">
        
        {/* Left Col: EvalBar + Board + KeyMoments + Graph */}
        <div className="flex flex-col gap-6 w-full xl:w-[648px] shrink-0">
          <div className="flex gap-4 h-[600px]">
            <EvalBar winProb={currentWinProb} cp={currentCp} mate={currentMate} />
            <div className="w-[600px] h-[600px] shadow-2xl rounded-xl overflow-hidden border border-slate-800 relative ring-1 ring-white/10">
              <ChessBoard
                fen={fen}
                onMove={handleMove}
                shapes={shapes}
              />
              {showReport && (
                <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50 backdrop-blur-md">
                  <GameReport stats={stats} onClose={() => setShowReport(false)} />
                </div>
              )}
            </div>
          </div>
          
          <div className="flex gap-4 w-full h-[150px]">
            <div className="flex-1 glass-panel rounded-xl overflow-hidden p-3 relative">
              <EvalGraph records={records} />
            </div>
            <div className="w-[200px] shrink-0">
              <KeyMoments records={records} onNodeSelect={handleNodeSelect} />
            </div>
          </div>
        </div>

        {/* Middle Col: MoveList & Explorer */}
        <div className="flex flex-col gap-6 w-full xl:w-[320px] shrink-0 h-[774px]">
          <div className="flex-1 min-h-[400px]">
            <MoveList 
              records={records} 
              activeIndex={activeRecord ? records.indexOf(activeRecord) : undefined} 
              onNodeClick={(index) => {
                const node = records[index];
                if (node) handleNodeSelect(node.nodeId);
              }} 
            />
          </div>
          
          <div className="h-[280px] glass-panel-light rounded-xl overflow-hidden relative">
            <Explorer data={explorerData} onMoveSelect={(move) => {
              if (move && move.uci) gmRef.current?.playMove(move.uci);
            }}/>
          </div>
        </div>

        {/* Right Col: Controls & Premium CoachBubble */}
        <div className="flex flex-col gap-6 w-full xl:w-[420px] h-[774px]">
          {/* Controls Bar */}
          <div className="glass-panel rounded-xl p-3 flex gap-3 justify-between items-center shrink-0">
            <button onClick={() => setShowReport(true)} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-all shadow-lg shadow-indigo-500/20 flex items-center gap-2 flex-1 justify-center text-white border border-indigo-400/30">
              <span>📊</span> Bilan
            </button>
            <button 
              onClick={toggleThreatMode}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all shadow-lg flex items-center gap-2 flex-1 justify-center border
                ${threatMode 
                  ? 'bg-red-500/20 text-red-300 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
                  : 'hover:bg-slate-800/60 text-slate-300 border-slate-700/50'
                }`}
            >
              <span>🚨</span> Menaces
            </button>
            <div className="flex gap-2">
              <button onClick={handleExportPgn} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors shadow-md border border-slate-700/50 flex items-center justify-center text-slate-300 hover:text-white" title="Exporter PGN">
                <span>💾</span>
              </button>
              <button onClick={handleImportPgn} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors shadow-md border border-slate-700/50 flex items-center justify-center text-slate-300 hover:text-white" title="Importer PGN">
                <span>📂</span>
              </button>
            </div>
          </div>

          {/* Huge Coach Bubble Panel */}
          <div className="flex-1 overflow-hidden min-h-[400px]">
            <CoachBubble record={activeRecord} />
          </div>
        </div>

      </div>
    </main>
  );
}
