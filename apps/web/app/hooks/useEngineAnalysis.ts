'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { GameManager, ExplorerResult } from '@chess-analyzer/chess-core';
import { EvalNormalizer, MotifEngine, pvToShape, CloudEvalService, ExplorerService } from '@chess-analyzer/chess-core';
import type { EngineEvaluation } from '@chess-analyzer/chess-core/src/events/GameEventBus';
import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';

export interface EvalState {
  winProb: number;
  cp?: number;
  mate?: number;
  depth: number;
  source?: 'cloud' | 'local';
  status: 'idle' | 'analyzing' | 'ready' | 'error';
}

export interface UseEngineAnalysisOptions {
  gmRef: React.RefObject<GameManager | null>;
  fen: string;
  onFenChange: (fen: string) => void;
  showNotice: (msg: string, durationMs?: number) => void;
}

export function useEngineAnalysis({ gmRef, fen, onFenChange, showNotice }: UseEngineAnalysisOptions) {
  const [evalState, setEvalState] = useState<EvalState>({ winProb: 0, cp: 0, depth: 0, status: 'idle' });
  const [shapes, setShapes] = useState<Array<{ orig: string; dest?: string; brush: string }>>([]);
  const [threatMode, setThreatMode] = useState(false);
  const [showLines, setShowLines] = useState(false);
  const showLinesRef = useRef(false);
  const [explorerData, setExplorerData] = useState<ExplorerResult>(null);

  const multiPvs = useRef<Map<number, EngineEvaluation>>(new Map());
  const threatPvs = useRef<Map<number, EngineEvaluation>>(new Map());
  const explorerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Throttles: RAF for evaluation updates (1 setState per frame max)
  const evalAccum = useRef<{ value: EvalState | null }>({ value: null });
  const evalRaf = useRef<number | null>(null);

  // Throttles: 100ms for board shapes
  const shapeAccum = useRef<{ value: Array<{ orig: string; dest?: string; brush: string }> | null }>({ value: null });
  const shapeRaf = useRef<number | null>(null);
  const lastShapeFlush = useRef(0);

  const scheduleEvalFlush = useCallback(() => {
    if (evalRaf.current !== null) return;
    evalRaf.current = requestAnimationFrame(() => {
      evalRaf.current = null;
      const pending = evalAccum.current.value;
      if (!pending) return;
      evalAccum.current.value = null;
      setEvalState(pending);
    });
  }, []);

  const scheduleShapeFlush = useCallback(() => {
    if (shapeRaf.current !== null) return;
    const wait = Math.max(0, 100 - (performance.now() - lastShapeFlush.current));
    shapeRaf.current = window.setTimeout(() => {
      shapeRaf.current = null;
      lastShapeFlush.current = performance.now();
      const pending = shapeAccum.current.value;
      if (!pending) return;
      shapeAccum.current.value = null;
      setShapes(pending);
    }, wait) as unknown as number;
  }, []);

  // Motif cache by FEN
  const motifCache = useRef<{
    fen: string;
    shapes: Array<{ orig: string; dest?: string; brush: string }>;
  } | null>(null);

  const getMotifShapes = useCallback((fenStr: string) => {
    if (motifCache.current && motifCache.current.fen === fenStr) {
      return motifCache.current.shapes;
    }
    const out: Array<{ orig: string; dest?: string; brush: string }> = [];
    try {
      const pos = Chess.fromSetup(parseFen(fenStr).unwrap()).unwrap();
      for (const u of MotifEngine.detectUndefended(pos.board, pos.epSquare)) {
        const file = String.fromCharCode(97 + (u.square % 8));
        const rank = Math.floor(u.square / 8) + 1;
        out.push({ orig: `${file}${rank}`, brush: 'red' });
      }
      for (const p of MotifEngine.detectPins(pos.board)) {
        const file = String.fromCharCode(97 + (p.pinned % 8));
        const rank = Math.floor(p.pinned / 8) + 1;
        out.push({ orig: `${file}${rank}`, brush: 'blue' });
      }
    } catch {
      // Unreadable position: safe fallback
    }
    motifCache.current = { fen: fenStr, shapes: out };
    return out;
  }, []);

  const fetchExplorerDebounced = useCallback((fenStr: string) => {
    if (explorerTimer.current) clearTimeout(explorerTimer.current);
    explorerTimer.current = setTimeout(() => {
      ExplorerService.fetch(fenStr).then(setExplorerData);
    }, 300);
  }, []);

  const fetchCloudEval = useCallback((fenStr: string) => {
    if (cloudTimer.current) clearTimeout(cloudTimer.current);
    cloudTimer.current = setTimeout(() => {
      CloudEvalService.fetch(fenStr, 3).then((evals) => {
        if (!evals || evals.length === 0) return;
        const current = gmRef.current?.moveManager.getFen();
        if (current && evals[0].fen !== current) return;

        // Let Cloud Win : arrêt du moteur local si le nuage fournit une évaluation suffisante
        if (evals[0].depth >= 14 || typeof evals[0].mate === 'number') {
          gmRef.current?.engineManager.stop();
        }

        for (const ev of evals) {
          if (current && ev.fen !== current) continue;
          gmRef.current?.eventBus.emit('EngineEvaluationUpdated', ev);
        }
      });
    }, 50);
  }, [gmRef]);

  const toggleThreatMode = useCallback(() => {
    setThreatMode((prev) => {
      const next = !prev;
      if (next) {
        setShapes([]);
        gmRef.current?.engineManager.analyzeThreat(fen);
      } else {
        gmRef.current?.engineManager.analyze(fen);
      }
      return next;
    });
  }, [fen, gmRef]);

  const toggleLines = useCallback(() => {
    setShowLines((prev) => {
      const next = !prev;
      showLinesRef.current = next;
      const engine = gmRef.current?.engineManager;
      if (!engine) return next;
      engine.setMultiPv(next ? 3 : 1);
      if (!next) {
        multiPvs.current.delete(2);
        multiPvs.current.delete(3);
        setShapes((prevShapes) => prevShapes.filter((s) => s.brush !== 'paleBlue'));
      }
      const currentFen = gmRef.current?.moveManager.getFen();
      if (currentFen) engine.analyze(currentFen, 14);
      return next;
    });
  }, [gmRef]);

  const depthLabel = useMemo(() => {
    if (evalState.status === 'error') return 'Erreur';
    if (evalState.status === 'idle' || evalState.depth === 0) return 'Initialisation…';
    if (evalState.source === 'cloud') return `Nuage · profondeur ${evalState.depth}`;
    if (evalState.depth >= 14) return `Profondeur ${evalState.depth}`;
    return `Profondeur ${evalState.depth}/14`;
  }, [evalState.status, evalState.depth, evalState.source]);

  // Hook up event listeners to game manager
  const setupEngineListeners = useCallback(
    (gm: GameManager) => {
      const eventBus = gm.eventBus;

      const unsubEval = eventBus.on('EngineEvaluationUpdated', (evaluation) => {
        multiPvs.current.set(evaluation.multiPv || 1, evaluation);

        if (!evaluation.multiPv || evaluation.multiPv === 1) {
          const currentFen = gm.moveManager.getFen();
          if (evaluation.fen && evaluation.fen !== currentFen) return;

          // Garde de préséance : ne jamais écraser une évaluation cloud à haute profondeur
          // par une évaluation locale de profondeur inférieure
          const currentEval = evalAccum.current.value ?? evalState;
          if (
            currentEval.source === 'cloud' &&
            evaluation.source !== 'cloud' &&
            currentEval.depth >= evaluation.depth
          ) {
            return;
          }

          const turn = currentFen.split(' ')[1] === 'w' ? 'white' : 'black';
          const normCp = EvalNormalizer.normalize(evaluation.cp, evaluation.mate, turn);
          const sign = turn === 'white' ? 1 : -1;

          evalAccum.current.value = {
            winProb: EvalNormalizer.cpToWinningChances(normCp),
            cp: typeof evaluation.cp === 'number' ? normCp : undefined,
            mate: typeof evaluation.mate === 'number' ? evaluation.mate * sign : undefined,
            depth: evaluation.depth,
            source: evaluation.source ?? 'local',
            status: evaluation.depth >= 14 ? 'ready' : 'analyzing',
          };
          scheduleEvalFlush();
        }

        const newShapes: Array<{ orig: string; dest?: string; brush: string }> = [];
        const pv3 = multiPvs.current.get(3);
        const pv2 = multiPvs.current.get(2);
        const pv1 = multiPvs.current.get(1);

        const alternatives: Array<[EngineEvaluation | undefined, string]> = showLinesRef.current
          ? [
              [pv3, 'paleBlue'],
              [pv2, 'paleBlue'],
            ]
          : [];

        // Flèches d'analyse comme dans Lichess : le meilleur coup (PV 1) est une flèche verte nette
        for (const [pv, brush] of [...alternatives, [pv1, 'green']] as Array<[EngineEvaluation | undefined, string]>) {
          const shape = pvToShape(pv?.pv, brush);
          if (shape) newShapes.push(shape);
        }

        shapeAccum.current.value = newShapes;
        scheduleShapeFlush();
      });

      const unsubThreat = eventBus.on('ThreatEvaluationUpdated', (evaluation) => {
        threatPvs.current.set(evaluation.multiPv || 1, evaluation);
        const newShapes: Array<{ orig: string; dest?: string; brush: string }> = [];
        const pv3 = threatPvs.current.get(3);
        const pv2 = threatPvs.current.get(2);
        const pv1 = threatPvs.current.get(1);

        for (const [pv, brush] of [
          [pv3, 'paleRed'],
          [pv2, 'paleRed'],
          [pv1, 'red'],
        ] as const) {
          const shape = pvToShape(pv?.pv, brush);
          if (shape) newShapes.push(shape);
        }
        setShapes(newShapes);
      });

      const unsubStarted = eventBus.on('AnalysisStarted', () => {
        setEvalState((prev) => ({ ...prev, depth: 0, status: 'analyzing' }));
      });

      const unsubError = eventBus.on('EngineError', (message) => {
        setEvalState((prev) => ({ ...prev, status: 'error' }));
        showNotice(`Moteur Stockfish : ${message}`, 10000);
      });

      const unsubPos = eventBus.on('PositionChanged', ({ fen: newFen }) => {
        multiPvs.current.clear();
        threatPvs.current.clear();
        motifCache.current = null;
        onFenChange(newFen);
        setEvalState((prev) => ({ ...prev, source: undefined }));
        fetchExplorerDebounced(newFen);
        fetchCloudEval(newFen);
      });

      return () => {
        unsubEval?.();
        unsubThreat?.();
        unsubStarted?.();
        unsubError?.();
        unsubPos?.();
        if (cloudTimer.current) clearTimeout(cloudTimer.current);
        if (explorerTimer.current) clearTimeout(explorerTimer.current);
        if (evalRaf.current !== null) cancelAnimationFrame(evalRaf.current);
        if (shapeRaf.current !== null) clearTimeout(shapeRaf.current);
      };
    },
    [
      fetchCloudEval,
      fetchExplorerDebounced,
      getMotifShapes,
      onFenChange,
      scheduleEvalFlush,
      scheduleShapeFlush,
      showNotice,
    ]
  );

  return {
    evalState,
    shapes,
    setShapes,
    threatMode,
    setThreatMode,
    showLines,
    explorerData,
    depthLabel,
    toggleThreatMode,
    toggleLines,
    fetchExplorerDebounced,
    fetchCloudEval,
    fetchCloudEvalDebounced: fetchCloudEval,
    setupEngineListeners,
  };
}
