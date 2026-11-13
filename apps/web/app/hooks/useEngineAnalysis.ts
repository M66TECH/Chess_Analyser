'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { GameManager, ExplorerResult } from '@chess-analyzer/chess-core';
import {
  EvalNormalizer,
  pvToShape,
  CloudEvalService,
  ExplorerService,
  DEFAULT_TARGET_DEPTH,
} from '@chess-analyzer/chess-core';
import type { EngineEvaluation } from '@chess-analyzer/chess-core/src/events/GameEventBus';

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

/** Profondeur locale minimale avant d'afficher une flèche verte (évite le bruit tactique depth 1..11). */
const MIN_ARROW_DEPTH = 12;

function buildAnalysisShapes(
  pvs: Map<number, EngineEvaluation>,
  showLines: boolean
): Array<{ orig: string; dest?: string; brush: string }> {
  const newShapes: Array<{ orig: string; dest?: string; brush: string }> = [];
  const pv3 = pvs.get(3);
  const pv2 = pvs.get(2);
  const pv1 = pvs.get(1);

  const alternatives: Array<[EngineEvaluation | undefined, string]> = showLines
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
  return newShapes;
}

export function useEngineAnalysis({ gmRef, fen, onFenChange, showNotice }: UseEngineAnalysisOptions) {
  const [evalState, setEvalState] = useState<EvalState>({ winProb: 0, cp: 0, depth: 0, status: 'idle' });
  const evalStateRef = useRef<EvalState>(evalState);
  const [shapes, setShapes] = useState<Array<{ orig: string; dest?: string; brush: string }>>([]);
  const [threatMode, setThreatMode] = useState(false);
  const threatModeRef = useRef(false);
  const [showLines, setShowLines] = useState(false);
  const showLinesRef = useRef(false);
  const [explorerData, setExplorerData] = useState<ExplorerResult>(null);

  useEffect(() => {
    evalStateRef.current = evalState;
  }, [evalState]);

  useEffect(() => {
    threatModeRef.current = threatMode;
  }, [threatMode]);

  useEffect(() => {
    showLinesRef.current = showLines;
  }, [showLines]);

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

  const fetchExplorerDebounced = useCallback(
    (fenStr: string) => {
      if (explorerTimer.current) clearTimeout(explorerTimer.current);
      explorerTimer.current = setTimeout(() => {
        ExplorerService.fetch(fenStr).then((data) => {
          const current = gmRef.current?.moveManager.getFen();
          if (current && current !== fenStr) return;
          setExplorerData(data);
        });
      }, 300);
    },
    [gmRef]
  );

  const fetchCloudEval = useCallback((fenStr: string) => {
    if (cloudTimer.current) clearTimeout(cloudTimer.current);
    cloudTimer.current = setTimeout(() => {
      CloudEvalService.fetch(fenStr, 3).then((evals) => {
        if (!evals || evals.length === 0) return;
        const current = gmRef.current?.moveManager.getFen();
        if (current && evals[0].fen !== current) return;

        // Let Cloud Win : arrêt du moteur local si le nuage fournit une évaluation profonde (>= 30) ou un mat
        if (evals[0].depth >= 30 || typeof evals[0].mate === 'number') {
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
    const next = !threatModeRef.current;
    threatModeRef.current = next;
    setThreatMode(next);
    const currentFen = gmRef.current?.moveManager.getFen() ?? fen;
    if (next) {
      setShapes([]);
      gmRef.current?.engineManager.analyzeThreat(currentFen);
    } else {
      gmRef.current?.engineManager.analyze(currentFen, DEFAULT_TARGET_DEPTH, undefined, true);
    }
  }, [fen, gmRef]);

  const toggleLines = useCallback(() => {
    const next = !showLinesRef.current;
    showLinesRef.current = next;
    setShowLines(next);
    const engine = gmRef.current?.engineManager;
    if (!engine) return;
    engine.setMultiPv(next ? 3 : 1);
    if (!next) {
      multiPvs.current.delete(2);
      multiPvs.current.delete(3);
      setShapes((prevShapes) => prevShapes.filter((s) => s.brush !== 'paleBlue'));
    }
    const currentFen = gmRef.current?.moveManager.getFen();
    if (currentFen) engine.analyze(currentFen, DEFAULT_TARGET_DEPTH, undefined, true);
  }, [gmRef]);

  const depthLabel = useMemo(() => {
    if (evalState.status === 'error') return 'Erreur';
    if (evalState.status === 'idle' || evalState.depth === 0) return 'Initialisation…';
    if (evalState.source === 'cloud') return `Nuage · profondeur ${evalState.depth}`;
    if (evalState.depth >= DEFAULT_TARGET_DEPTH) return `Profondeur ${evalState.depth}`;
    return `Profondeur ${evalState.depth}/${DEFAULT_TARGET_DEPTH}`;
  }, [evalState.status, evalState.depth, evalState.source]);

  // Hook up event listeners to game manager
  const setupEngineListeners = useCallback(
    (gm: GameManager) => {
      const eventBus = gm.eventBus;

      const unsubEval = eventBus.on('EngineEvaluationUpdated', (evaluation) => {
        const currentFen = gm.moveManager.getFen();
        // Filtrer AVANT tout stockage multiPv ou shape pour qu'une évaluation d'une
        // autre position (PV1, PV2, PV3) ne pollue jamais la position affichée.
        if (evaluation.fen && evaluation.fen !== currentFen) return;

        // Garde de préséance AVANT stockage multiPvs : ne jamais écraser une évaluation
        // cloud à haute profondeur par une évaluation locale moins profonde.
        const currentEval = evalAccum.current.value ?? evalStateRef.current;
        if (
          currentEval.source === 'cloud' &&
          evaluation.source !== 'cloud' &&
          currentEval.depth >= evaluation.depth
        ) {
          return;
        }

        multiPvs.current.set(evaluation.multiPv || 1, evaluation);

        if (!evaluation.multiPv || evaluation.multiPv === 1) {
          const turn = currentFen.split(' ')[1] === 'w' ? 'white' : 'black';
          const normCp = EvalNormalizer.normalize(evaluation.cp, evaluation.mate, turn);
          const sign = turn === 'white' ? 1 : -1;

          const nextState: EvalState = {
            winProb: EvalNormalizer.cpToWinningChances(normCp),
            cp: typeof evaluation.cp === 'number' ? normCp : undefined,
            mate: typeof evaluation.mate === 'number' ? evaluation.mate * sign : undefined,
            depth: evaluation.depth,
            source: evaluation.source ?? 'local',
            status: evaluation.depth >= DEFAULT_TARGET_DEPTH ? 'ready' : 'analyzing',
          };
          evalAccum.current.value = nextState;
          evalStateRef.current = nextState;
          scheduleEvalFlush();
        }

        // Ne dessiner la flèche verte qu'à partir d'une profondeur fiable (ou Cloud / mat)
        // afin d'éviter des coups instinctifs erronés affichés à profondeur 1..11.
        const pv1 = multiPvs.current.get(1);
        const arrowReliable =
          evaluation.source === 'cloud' ||
          typeof evaluation.mate === 'number' ||
          evaluation.depth >= MIN_ARROW_DEPTH ||
          pv1?.source === 'cloud' ||
          typeof pv1?.mate === 'number' ||
          (pv1?.depth ?? 0) >= MIN_ARROW_DEPTH;

        if (!arrowReliable) return;

        shapeAccum.current.value = buildAnalysisShapes(multiPvs.current, showLinesRef.current);
        scheduleShapeFlush();
      });

      const unsubFinished = eventBus.on('AnalysisFinished', () => {
        if (threatModeRef.current || multiPvs.current.size === 0) return;
        const shapesReady = buildAnalysisShapes(multiPvs.current, showLinesRef.current);
        if (shapesReady.length > 0) {
          shapeAccum.current.value = null;
          if (shapeRaf.current !== null) {
            clearTimeout(shapeRaf.current);
            shapeRaf.current = null;
          }
          setShapes(shapesReady);
        }
      });

      const unsubThreat = eventBus.on('ThreatEvaluationUpdated', (evaluation) => {
        if (!threatModeRef.current) return;
        if (evaluation.fen) {
          const currentPlacement = gm.moveManager.getFen().split(' ')[0];
          if (evaluation.fen.split(' ')[0] !== currentPlacement) return;
        }
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
        setEvalState((prev) => {
          if (prev.source === 'cloud') return prev;
          const next: EvalState = { ...prev, depth: 0, status: 'analyzing' };
          evalStateRef.current = next;
          return next;
        });
      });

      const unsubError = eventBus.on('EngineError', (message) => {
        setEvalState((prev) => ({ ...prev, status: 'error' }));
        showNotice(`Moteur Stockfish : ${message}`, 10000);
      });

      const unsubPos = eventBus.on('PositionChanged', ({ fen: newFen }) => {
        multiPvs.current.clear();
        threatPvs.current.clear();
        evalAccum.current.value = null;
        shapeAccum.current.value = null;
        if (shapeRaf.current !== null) {
          clearTimeout(shapeRaf.current);
          shapeRaf.current = null;
        }
        setShapes([]);
        onFenChange(newFen);
        setEvalState((prev) => {
          const next: EvalState = { ...prev, depth: 0, source: undefined, status: 'analyzing' };
          evalStateRef.current = next;
          return next;
        });
        fetchExplorerDebounced(newFen);
        fetchCloudEval(newFen);
      });

      return () => {
        unsubEval?.();
        unsubFinished?.();
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
