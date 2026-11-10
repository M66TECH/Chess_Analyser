'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBullseye,
  faChartLine,
  faCrosshairs,
  faSliders,
  faRotate,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import {
  ChessBoard,
  EvalGraph,
  EvalBar,
  MoveList,
  GameReport,
  Explorer,
  KeyMoments,
  CoachBubble,
  PgnImportModal,
  PromotionDialog,
  BoardDemo,
  DemoBanner,
  SoundService,
  GameReviewModal,
  RetryBlunderBanner,
  MoveTree,
} from '@chess-analyzer/ui';
import {
  GameManager,
  MoveRecord,
  MoveNode,
  AccuracyScore,
  MatchSummaryService,
  PgnParser,
  ExplanationEngine,
  buildDemo,
  evaluateRetryMove,
  uciToShape,
  serializeGame,
  parseStoredGame,
  GAME_STORE_KEY,
  LocalMode,
  type DemoStep,
} from '@chess-analyzer/chess-core';
import { NavigationBar } from './components/NavigationBar';
import { MobileNavigationTabs, type MobilePanelTab } from './components/MobileNavigationTabs';
import { HelpModal } from './components/HelpModal';
import { useEngineAnalysis } from './hooks/useEngineAnalysis';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

type PromotionCallback = (piece: 'q' | 'r' | 'b' | 'n') => void;

export default function Home() {
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [previewFen, setPreviewFen] = useState<string | null>(null);
  const [records, setRecords] = useState<MoveRecord[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  // Copie de l'arbre de coups pour le rendu : lire `gmRef.current` pendant le
  // rendu est interdit (ref mutable) ; on rafraîchit cet état depuis les
  // gestionnaires d'événements du GameManager.
  const [treeNodes, setTreeNodes] = useState<Map<string, MoveNode>>(() => new Map());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>(undefined);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [notice, setNotice] = useState<string | null>(null);

  // Modals & Panels
  const [showReport, setShowReport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showGameReview, setShowGameReview] = useState(false);
  const [retryState, setRetryState] = useState<{
    blunderRecord: MoveRecord;
    status: 'idle' | 'success' | 'failed';
    isExactBest?: boolean;
    message?: string;
    revealed: boolean;
  } | null>(null);
  const [retryFen, setRetryFen] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string; callback: PromotionCallback } | null>(null);
  const [demo, setDemo] = useState<{
    title: string;
    startFen: string;
    steps: DemoStep[];
    mode: 'idea' | 'punish';
    hasBothModes: boolean;
    record: MoveRecord;
  } | null>(null);
  const [demoIndex, setDemoIndex] = useState(-1);
  const [isDemoPlaying, setIsDemoPlaying] = useState(false);
  const demoAutoPlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanelTab>('coach');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [localOnly, setLocalOnly] = useState(false);
  const [hoveredShapes, setHoveredShapes] = useState<Array<{ orig: string; dest?: string; brush: string }> | null>(null);

  const gmRef = useRef<GameManager | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((msg: string, durationMs = 6000) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), durationMs);
  }, []);

  // Hook 1: Engine Analysis & Evaluations
  const {
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
    setupEngineListeners,
  } = useEngineAnalysis({
    gmRef,
    fen,
    onFenChange: setFen,
    showNotice,
  });

  // Sound state sync
  useEffect(() => {
    // Lecture de préférences navigateur (localStorage) : impossible côté
    // serveur, donc synchronisées après l'hydratation pour éviter un écart SSR.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSoundEnabled(SoundService.getInstance().isEnabled());
    // P3.14 — synchronise le badge « Local/Connecté » avec la préférence persistée.
    setLocalOnly(LocalMode.enabled);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // --- Persistence: save / restore (schéma versionné, cf. GameStore) ---
  const saveGame = useCallback(() => {
    const gm = gmRef.current;
    if (!gm) return;
    const uciMoves = gm.moveManager.getUciMoves();
    if (uciMoves.length === 0) {
      try { localStorage.removeItem(GAME_STORE_KEY); } catch {}
      return;
    }

    const initialFen = gm.moveManager.getInitialFen();
    const payload = serializeGame({
      moves: uciMoves,
      records: gm.getMoveRecords(),
      initialFen,
    });

    // Deux niveaux de repli en cas de quota : complet puis sans records.
    const attempts = [
      payload.json,
      serializeGame({ moves: uciMoves, records: [], initialFen }).json,
    ].filter(Boolean);

    for (const json of attempts) {
      try {
        localStorage.setItem(GAME_STORE_KEY, json);
        return;
      } catch {}
    }
  }, []);

  const saveGameDebounced = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      saveGame();
    }, 1500);
  }, [saveGame]);

  const syncLastMoveFromBoard = useCallback(() => {
    const moves = gmRef.current?.moveManager.getUciMoves() ?? [];
    const last = moves.at(-1);
    setLastMove(last ? [last.slice(0, 2), last.slice(2, 4)] : undefined);
  }, []);

  const restoreGame = useCallback(() => {
    let raw: string | null;
    try {
      raw = localStorage.getItem(GAME_STORE_KEY);
    } catch {
      return false;
    }
    if (!raw) return false;

    const parsed = parseStoredGame(raw);
    if (!parsed.ok || !parsed.game) {
      // Format inconnu / corrompu : on prévient et on n'écrase PAS la sauvegarde
      // (l'utilisateur peut encore l'exporter manuellement).
      console.warn('[restoreGame]', parsed.error);
      showNotice(`Sauvegarde illisible : ${parsed.error ?? 'format inconnu'}`, 8000);
      return false;
    }

    const gm = gmRef.current;
    if (!gm) return false;
    // Les records d'un ancien format (sans `v`) ne sont pas réutilisés : la
    // partie est rejouée et réanalysée, ce qui reste correct.
    const savedRecords = parsed.game.records as unknown as MoveRecord[] | undefined;
    if (!gm.restoreSession(parsed.game.moves, savedRecords, parsed.game.initialFen)) return false;

    setRecords(gm.getMoveRecords());
    setTreeNodes(new Map(gm.getTree().nodes));
    setActiveNodeId(gm.getActiveNodeId());
    return true;
  }, [showNotice]);

  // --- Core Lifecycle: GameManager init & listener bindings ---
  useEffect(() => {
    const gm = new GameManager();
    gmRef.current = gm;
    const eventBus = gm.eventBus;

    const unsubPedagogy = eventBus.on('PedagogyUpdated', () => {
      const next = gm.getMoveRecords();
      setRecords((prev) =>
        prev.length === next.length && prev.at(-1)?.coachCard === next.at(-1)?.coachCard ? prev : next
      );
      saveGameDebounced();
    });

    const unsubMove = eventBus.on('MovePlayed', ({ nodeId }) => {
      setTreeNodes(new Map(gm.getTree().nodes));
      setActiveNodeId(nodeId);
      setHoveredShapes(null);
    });
    const unsubNav = eventBus.on('NavigateTo', ({ nodeId }) => {
      setActiveNodeId(nodeId);
      setHoveredShapes(null);
    });
    const cleanupEngine = setupEngineListeners(gm);

    gm.init();

    const restoreTimer = setTimeout(() => {
      if (restoreGame()) {
        syncLastMoveFromBoard();
        showNotice('Partie précédente restaurée.', 3000);
      }
    }, 0);

    return () => {
      clearTimeout(restoreTimer);
      unsubPedagogy?.();
      unsubMove?.();
      unsubNav?.();
      cleanupEngine();
      gm.terminate();
    };
  }, [restoreGame, saveGameDebounced, setupEngineListeners, showNotice, syncLastMoveFromBoard]);

  // Hook 2: Keyboard shortcuts
  useKeyboardShortcuts(
    useMemo(
      () => ({
        onPrev: () => gmRef.current?.navigatePrev(),
        onNext: () => gmRef.current?.navigateNext(),
        onFirst: () => gmRef.current?.navigateFirst(),
        onLast: () => gmRef.current?.navigateLast(),
        onFlipBoard: () => setOrientation((o) => (o === 'white' ? 'black' : 'white')),
        onCloseModals: () => {
          setShowReport(false);
          setShowImport(false);
          setShowHelp(false);
          setShowGameReview(false);
          setRetryState(null);
          setRetryFen(null);
        },
        onToggleHelp: () => setShowHelp((h) => !h),
      }),
      []
    )
  );

  // Stats calculation
  const stats = useMemo(() => {
    const summary = MatchSummaryService.generateSummary(records);
    // P1-8 : startColor est dérivé du PREMIER record. Un PGN au trait aux
    // Noirs inversait l'attribution de la précision entre les deux camps.
    // fenBefore[1] === 'b' = les Noirs avaient le trait au premier coup.
    const firstRecord = records[0];
    const startColor: 'white' | 'black' =
      firstRecord && firstRecord.fenBefore.split(' ')[1] === 'b' ? 'black' : 'white';
    const lichess = AccuracyScore.computeLichessAccuracy(records, startColor);
    return {
      ...summary,
      accuracy: {
        white: Math.round(lichess.white * 10) / 10,
        black: Math.round(lichess.black * 10) / 10,
      },
    };
  }, [records]);

  const activeIndex = useMemo(() => {
    if (!activeNodeId) return records.length > 0 ? records.length - 1 : undefined;
    const idx = records.findIndex((r) => r.nodeId === activeNodeId);
    return idx === -1 ? (records.length > 0 ? records.length - 1 : undefined) : idx;
  }, [records, activeNodeId]);

  const activeRecord = useMemo(() => {
    if (activeIndex === undefined || activeIndex < 0 || activeIndex >= records.length) return undefined;
    return records[activeIndex];
  }, [records, activeIndex]);

  const handleNodeSelect = useCallback((nodeId: string) => {
    gmRef.current?.navigateToNode(nodeId);
  }, []);

  const startRetryBlunder = useCallback((record: MoveRecord) => {
    setRetryState({
      blunderRecord: record,
      status: 'idle',
      revealed: false,
    });
    setRetryFen(record.fenBefore);
    setOrientation(record.color);
    setLastMove(undefined);
    setHoveredShapes(null);
  }, []);

  const cancelRetry = useCallback(() => {
    setRetryState(null);
    setRetryFen(null);
    syncLastMoveFromBoard();
  }, [syncLastMoveFromBoard]);

  const boardShapes = useMemo(() => {
    if (retryState) {
      if (retryState.revealed && retryState.blunderRecord.bestMove) {
        const best = uciToShape(retryState.blunderRecord.bestMove);
        return best ? [{ ...best, brush: 'green' }] : [];
      }
      return [];
    }
    if (hoveredShapes && hoveredShapes.length > 0) {
      return hoveredShapes;
    }
    // Flèche du meilleur coup comme dans Lichess lors de l'examen d'un coup
    if (activeRecord && activeRecord.bestMove && !shapes.some((s) => s.brush === 'green')) {
      const best = uciToShape(activeRecord.bestMove);
      if (best) {
        return [...shapes, { ...best, brush: 'green' }];
      }
    }
    return shapes;
  }, [retryState, hoveredShapes, shapes, activeRecord]);

  const handleMove = useCallback((from: string, to: string) => {
    if (retryState) {
      const uci = `${from}${to}`;
      const blunder = retryState.blunderRecord;
      const evalRes = evaluateRetryMove({
        candidateUci: uci,
        blunderRecord: blunder,
        candidateCp: evalState.cp,
      });

      if (evalRes.success) {
        SoundService.getInstance().play('castle');
        setRetryState((prev) =>
          prev ? { ...prev, status: 'success', isExactBest: evalRes.isExactBest, message: evalRes.message, revealed: true } : null
        );
      } else {
        SoundService.getInstance().play('blunder');
        setRetryState((prev) =>
          prev ? { ...prev, status: 'failed', message: evalRes.message } : null
        );
      }
      return;
    }

    const gm = gmRef.current;
    if (!gm) return;
    gm.pipeline.resetPending();

    const playSound = (san?: string) => {
      const s = san ?? '';
      if (s.includes('O-O')) SoundService.getInstance().play('castle');
      else if (s.includes('x')) SoundService.getInstance().play('capture');
      else if (s.includes('+') || s.includes('#')) SoundService.getInstance().play('check');
      else SoundService.getInstance().play('move');
    };

    if (gm.moveManager.isPromotion(from, to)) {
      setPromotion({
        from,
        to,
        callback: (piece: 'q' | 'r' | 'b' | 'n') => {
          const res = gm.playMove(`${from}${to}${piece}`);
          if (res.success) {
            setLastMove([from, to]);
            playSound(res.san);
          }
          setPromotion(null);
        },
      });
      return;
    }

    const res = gm.playMove(`${from}${to}`);
    if (res.success) {
      setLastMove([from, to]);
      playSound(res.san);
    }
  }, [retryState, evalState.cp]);

  const handleExplorerMove = useCallback((move: { san: string; uci: string }) => {
    if (!move.uci) return;
    setLastMove([move.uci.slice(0, 2), move.uci.slice(2, 4)]);
    const res = gmRef.current?.playMove(move.uci);
    if (res?.success) {
      const s = res.san ?? move.san ?? '';
      if (s.includes('O-O')) SoundService.getInstance().play('castle');
      else if (s.includes('x')) SoundService.getInstance().play('capture');
      else if (s.includes('+') || s.includes('#')) SoundService.getInstance().play('check');
      else SoundService.getInstance().play('move');
    }
  }, []);

  const handleShowDemo = useCallback(
    (record: MoveRecord, forceMode?: 'idea' | 'punish') => {
      const isError =
        record.classification === 'inaccuracy' ||
        record.classification === 'mistake' ||
        record.classification === 'blunder';
      const refutation = record.refutationPv ?? [];
      const best = (record.bestPv && record.bestPv.length > 0)
        ? record.bestPv
        : (record.bestMove ? [record.bestMove] : []);

      const hasRefutation = refutation.length > 0;
      const hasBest = best.length > 0;

      if (!hasRefutation && !hasBest) {
        showNotice('Pas de suite de coups disponible pour ce coup.', 4000);
        return;
      }

      let mode: 'idea' | 'punish' = forceMode ?? (isError && hasRefutation ? 'punish' : 'idea');
      if (mode === 'punish' && !hasRefutation) mode = 'idea';
      if (mode === 'idea' && !hasBest) mode = 'punish';

      const isPunish = mode === 'punish';
      const startFen = isPunish ? record.fenAfter : record.fenBefore;
      const pv = isPunish ? refutation : best;
      const title = isPunish
        ? 'Comment l’adversaire peut en profiter'
        : 'Ce qu’il fallait jouer';

      const steps = buildDemo(startFen, pv, 6);
      if (steps.length === 0) {
        showNotice('Démonstration indisponible pour cette position.', 4000);
        return;
      }

      setDemo({
        title,
        startFen,
        steps,
        mode,
        hasBothModes: hasRefutation && hasBest,
        record,
      });
      setDemoIndex(-1);
      setIsDemoPlaying(false);

      const kind: 'punish' | 'idea' = isPunish ? 'punish' : 'idea';
      const demoFen = startFen;

      void ExplanationEngine.generateDemoCaptions({
        startFen: demoFen,
        uciMoves: steps.map((s) => s.uci),
        kind,
        fallbackCaptions: steps.map((s) => s.caption),
      }).then((captions) => {
        setDemo((current) => {
          if (!current || current.startFen !== demoFen || current.mode !== mode) return current;
          return {
            ...current,
            steps: current.steps.map((step, i) => ({
              ...step,
              caption: captions[i] ?? step.caption,
            })),
          };
        });
      });
    },
    [showNotice]
  );

  const canShowDemo = useCallback((record?: MoveRecord) => {
    if (!record) return false;
    return (
      (record.refutationPv?.length ?? 0) > 0 ||
      (record.bestPv?.length ?? 0) > 0 ||
      Boolean(record.bestMove)
    );
  }, []);

  const playStepSound = useCallback((step: DemoStep | null) => {
    if (!step) {
      SoundService.getInstance().play('move');
      return;
    }
    if (step.checkmate || step.check) {
      SoundService.getInstance().play('check');
    } else if (step.caption.includes('prend') || step.san?.includes('x')) {
      SoundService.getInstance().play('capture');
    } else {
      SoundService.getInstance().play('move');
    }
  }, []);

  const handleNextDemoStep = useCallback(() => {
    if (!demo) return;
    setDemoIndex((idx) => {
      const nextIdx = Math.min(idx + 1, demo.steps.length - 1);
      if (nextIdx >= 0 && nextIdx < demo.steps.length) {
        playStepSound(demo.steps[nextIdx]);
      }
      if (nextIdx >= demo.steps.length - 1) {
        setIsDemoPlaying(false);
      }
      return nextIdx;
    });
  }, [demo, playStepSound]);

  const handlePrevDemoStep = useCallback(() => {
    if (!demo) return;
    setDemoIndex((idx) => {
      const prevIdx = Math.max(-1, idx - 1);
      if (prevIdx >= 0) {
        playStepSound(demo.steps[prevIdx]);
      } else {
        SoundService.getInstance().play('move');
      }
      return prevIdx;
    });
  }, [demo, playStepSound]);

  const handleGoToDemoStep = useCallback(
    (targetIndex: number) => {
      if (!demo) return;
      const clamped = Math.max(-1, Math.min(targetIndex, demo.steps.length - 1));
      setDemoIndex(clamped);
      if (clamped >= 0 && clamped < demo.steps.length) {
        playStepSound(demo.steps[clamped]);
      } else {
        SoundService.getInstance().play('move');
      }
    },
    [demo, playStepSound]
  );

  const handleCloseDemo = useCallback(() => {
    setDemo(null);
    setDemoIndex(-1);
    setIsDemoPlaying(false);
    if (demoAutoPlayTimer.current) clearTimeout(demoAutoPlayTimer.current);
  }, []);

  // Autoplay de la démonstration
  useEffect(() => {
    if (!isDemoPlaying || !demo) {
      if (demoAutoPlayTimer.current) clearTimeout(demoAutoPlayTimer.current);
      return;
    }
    if (demoIndex >= demo.steps.length - 1) {
      // Fin de la démonstration : transition d'état terminale, pas de dérivation possible.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsDemoPlaying(false);
      return;
    }
    demoAutoPlayTimer.current = setTimeout(() => {
      handleNextDemoStep();
    }, 1300);
    return () => {
      if (demoAutoPlayTimer.current) clearTimeout(demoAutoPlayTimer.current);
    };
  }, [isDemoPlaying, demo, demoIndex, handleNextDemoStep]);

  // Raccourcis clavier pendant la démonstration
  useEffect(() => {
    if (!demo) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsDemoPlaying(false);
        handleNextDemoStep();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsDemoPlaying(false);
        handlePrevDemoStep();
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsDemoPlaying((p) => !p);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseDemo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [demo, handleNextDemoStep, handlePrevDemoStep, handleCloseDemo]);

  const demoCurrentStep = useMemo(() => {
    if (!demo || demoIndex < 0 || demoIndex >= demo.steps.length) return null;
    return demo.steps[demoIndex];
  }, [demo, demoIndex]);

  const demoFen = useMemo(() => {
    if (!demo) return null;
    return demoCurrentStep ? demoCurrentStep.fen : demo.startFen;
  }, [demo, demoCurrentStep]);

  const demoLastMove: [string, string] | undefined = useMemo(() => {
    if (!demoCurrentStep) return undefined;
    return [demoCurrentStep.from, demoCurrentStep.to];
  }, [demoCurrentStep]);

  const demoShapes = useMemo(() => {
    if (!demo) return null;
    if (demoIndex < 0) {
      const first = demo.steps[0];
      return first ? [{ orig: first.from, dest: first.to, brush: 'green' }] : [];
    }
    if (!demoCurrentStep) return [];
    const out: Array<{ orig: string; dest?: string; brush: string }> = [
      { orig: demoCurrentStep.from, dest: demoCurrentStep.to, brush: 'green' },
    ];
    if (demoCurrentStep.threat) {
      out.push({ orig: demoCurrentStep.threat, brush: 'red' });
    }
    const nextStep = demo.steps[demoIndex + 1];
    if (nextStep) {
      out.push({ orig: nextStep.from, dest: nextStep.to, brush: 'paleBlue' });
    }
    return out;
  }, [demo, demoIndex, demoCurrentStep]);

  const handleExportPgn = useCallback(() => {
    if (records.length === 0) {
      showNotice('Aucun coup à exporter : jouez ou importez une partie.');
      return;
    }
    const tree = gmRef.current?.getTree();
    const pgnStr = PgnParser.exportAnnotatedPgn(
      records,
      tree && tree.nodes.size > 0 ? { nodes: tree.nodes, initialFen: tree.initialFen } : undefined
    );
    const blob = new Blob([pgnStr], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chess_analysis.pgn';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotice('PGN exporté.');
  }, [records, showNotice]);

  const handleImportPgn = useCallback(
    (pgnText: string) => {
      if (!pgnText || !gmRef.current) return;
      setShowImport(false);
      showNotice('Analyse de la partie en cours…', 15000);
      gmRef.current.loadPgn(pgnText).then((result) => {
        if (result.success) {
          setActiveNodeId(gmRef.current?.getActiveNodeId() ?? null);
          syncLastMoveFromBoard();
          setThreatMode(false);
          showNotice(`Partie chargée : ${result.moveCount ?? 0} coups analysés.`);
        } else {
          showNotice(`Import PGN impossible : ${result.error ?? 'format non reconnu'}`, 8000);
        }
      });
    },
    [showNotice, syncLastMoveFromBoard, setThreatMode]
  );

  const handleReset = useCallback(() => {
    const gm = gmRef.current;
    if (!gm) return;
    gm.resetGame();
    setActiveNodeId(null);
    setLastMove(undefined);
    setRecords([]);
    setTreeNodes(new Map());
    setThreatMode(false);
    try { localStorage.removeItem(GAME_STORE_KEY); } catch {}
    showNotice('Nouvelle partie.', 3000);
  }, [showNotice, setThreatMode]);

  return (
    <div className="min-h-screen w-full flex flex-col">
      <NavigationBar
        depthLabel={depthLabel}
        engineStatus={evalState.status}
        engineSource={evalState.source}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(SoundService.getInstance().toggle())}
        localOnly={localOnly}
        onToggleLocalOnly={() => {
          const next = LocalMode.toggle();
          setLocalOnly(next);
          showNotice(
            next
              ? 'Mode local : plus aucun envoi vers Lichess ou le coach IA.'
              : 'Mode connecté : ouvertures Lichess et coach IA réactivés.',
            5000
          );
        }}
        onImport={() => setShowImport(true)}
        onExport={handleExportPgn}
        onReset={handleReset}
        onHelp={() => setShowHelp(true)}
      />

      {notice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] max-w-lg w-[90%] glass-panel rounded-lg px-4 py-2.5 text-sm text-slate-200 flex items-center gap-3 shadow-2xl">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate-400 hover:text-white transition-colors shrink-0 p-1" aria-label="Fermer">
            <FontAwesomeIcon icon={faXmark} className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <main className="flex-1 w-full max-w-[1450px] mx-auto p-3 sm:p-4 xl:p-6">
        <div className="flex flex-col xl:flex-row gap-4 xl:gap-6 items-start justify-center">
          {/* Left Column: Board + EvalBar + Graph */}
          <div className="flex flex-col gap-3 sm:gap-4 w-full xl:w-auto xl:shrink-0">
            {retryState && (
              <div className="w-full max-w-[650px]">
                <RetryBlunderBanner
                  blunderRecord={retryState.blunderRecord}
                  status={retryState.status}
                  isExactBest={retryState.isExactBest}
                  message={retryState.message}
                  revealed={retryState.revealed}
                  onRevealSolution={() => setRetryState((prev) => (prev ? { ...prev, revealed: true } : null))}
                  onResetAttempt={() => {
                    setRetryFen(retryState.blunderRecord.fenBefore);
                    setRetryState((prev) => (prev ? { ...prev, status: 'idle', revealed: false } : null));
                  }}
                  onClose={cancelRetry}
                />
              </div>
            )}

            {/* Démonstration animée directement sur l'échiquier principal */}
            {demo && (
              <div className="w-full max-w-[650px]">
                <DemoBanner
                  title={demo.title}
                  steps={demo.steps}
                  currentIndex={demoIndex}
                  isPlaying={isDemoPlaying}
                  mode={demo.mode}
                  hasBothModes={demo.hasBothModes}
                  onSwitchMode={(newMode) => handleShowDemo(demo.record, newMode)}
                  onNext={handleNextDemoStep}
                  onPrev={handlePrevDemoStep}
                  onTogglePlay={() => setIsDemoPlaying((p) => !p)}
                  onReset={() => {
                    setDemoIndex(-1);
                    setIsDemoPlaying(false);
                  }}
                  onGoTo={handleGoToDemoStep}
                  onClose={handleCloseDemo}
                />
              </div>
            )}

            <div className="flex gap-2 sm:gap-3">
              <EvalBar winProb={evalState.winProb} cp={evalState.cp} mate={evalState.mate} orientation={orientation} />
              <div className="relative flex-1 aspect-square max-w-[600px] shadow-2xl rounded-xl overflow-hidden border border-slate-800 ring-1 ring-white/10">
                <ChessBoard
                  fen={demoFen ?? retryFen ?? previewFen ?? fen}
                  onMove={demo ? undefined : handleMove}
                  shapes={demoShapes ?? boardShapes}
                  lastMove={demoLastMove ?? lastMove}
                  orientation={orientation}
                  interactive={!demo && !previewFen}
                />
              </div>
            </div>

            {/* Controls Row */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setShowGameReview(true)}
                className="flex-1 min-w-[100px] px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors shadow-lg flex items-center gap-2 justify-center text-white border border-indigo-400/30"
                title="Lancer la revue guidée de la partie"
              >
                <FontAwesomeIcon icon={faBullseye} className="w-3.5 h-3.5 text-white" />
                <span>Revue</span>
              </button>
              <button
                onClick={() => setShowReport(true)}
                className="flex-1 min-w-[100px] px-3 py-2 bg-slate-800/80 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-700/50 flex items-center gap-2 justify-center text-slate-200"
              >
                <FontAwesomeIcon icon={faChartLine} className="w-3.5 h-3.5 text-slate-300" />
                <span>Bilan</span>
              </button>
              <button
                onClick={toggleThreatMode}
                className={`flex-1 min-w-[100px] px-3 py-2 rounded-lg text-sm font-medium transition-colors border flex items-center gap-2 justify-center ${
                  threatMode ? 'bg-red-500/20 text-red-300 border-red-500/50' : 'hover:bg-slate-800/60 text-slate-300 border-slate-700/50'
                }`}
              >
                <FontAwesomeIcon icon={faCrosshairs} className="w-3.5 h-3.5 text-red-400" />
                <span>Menaces</span>
              </button>
              <button
                onClick={toggleLines}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors border flex items-center gap-1.5 justify-center ${
                  showLines ? 'bg-sky-500/20 text-sky-300 border-sky-500/50' : 'bg-slate-800/70 hover:bg-slate-700 text-slate-300 border-slate-700/50'
                }`}
                title="Afficher les 3 meilleures lignes (plus lent)"
                aria-pressed={showLines}
              >
                <FontAwesomeIcon icon={faSliders} className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden sm:inline text-xs">Lignes</span>
              </button>
              <button
                onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
                className="px-3 py-2 bg-slate-800/70 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-700/50 text-slate-300 hover:text-white flex items-center justify-center"
                title="Retourner l'échiquier (F)"
              >
                <FontAwesomeIcon icon={faRotate} className="w-3.5 h-3.5" />
              </button>
            </div>

            <MobileNavigationTabs activePanel={mobilePanel} onSelectPanel={setMobilePanel} />

            {/* Graph + Key Moments */}
            <div className="flex gap-3 w-full h-[120px] sm:h-[150px]">
              <div className="flex-1 glass-panel rounded-xl overflow-hidden p-2 sm:p-3 relative">
                <EvalGraph
                  records={records}
                  activeIndex={activeIndex}
                  onPreviewIndex={(index) => {
                    if (index === null) setPreviewFen(null);
                    else setPreviewFen(records[index]?.fenAfter ?? null);
                  }}
                  onCommitIndex={(index) => {
                    setPreviewFen(null);
                    const node = records[index];
                    if (node) {
                      handleNodeSelect(node.nodeId);
                      SoundService.getInstance().play('move');
                    }
                  }}
                  onNodeClick={(index) => {
                    setPreviewFen(null);
                    const node = records[index];
                    if (node) {
                      handleNodeSelect(node.nodeId);
                      SoundService.getInstance().play('move');
                    }
                  }}
                />
              </div>
              <div className="w-[160px] sm:w-[200px] shrink-0">
                <KeyMoments
                  records={records}
                  onNodeSelect={handleNodeSelect}
                  onRetryBlunder={startRetryBlunder}
                  onStartReview={() => setShowGameReview(true)}
                />
              </div>
            </div>
          </div>

          {/* Middle Column: MoveList + Explorer */}
          <div className={`${mobilePanel === 'moves' || mobilePanel === 'explorer' ? 'flex' : 'hidden'} xl:flex flex-col gap-4 w-full xl:w-[300px] xl:shrink-0`}>
            <div className={`${mobilePanel === 'moves' ? 'block' : 'hidden'} xl:block h-[380px] xl:h-[460px]`}>
              {process.env.NEXT_PUBLIC_MOVE_TREE_ENABLED === 'true' ? (
                <MoveTree
                  nodes={treeNodes}
                  records={records}
                  activeNodeId={activeNodeId}
                  onSelectNode={handleNodeSelect}
                />
              ) : (
                <MoveList
                  records={records}
                  activeIndex={activeIndex}
                  onNodeClick={(index) => {
                    const node = records[index];
                    if (node) handleNodeSelect(node.nodeId);
                  }}
                />
              )}
            </div>
            <div className={`${mobilePanel === 'explorer' ? 'block' : 'hidden'} xl:block h-[280px] glass-panel-light rounded-xl overflow-hidden relative`}>
              <Explorer data={explorerData} onMoveSelect={handleExplorerMove} />
            </div>
          </div>

          {/* Right Column: Coach */}
          <div className={`${mobilePanel === 'coach' ? 'flex' : 'hidden'} xl:flex flex-col gap-4 w-full xl:w-[400px] xl:shrink-0`}>
            <div className="min-h-[300px] xl:min-h-[420px]">
              <CoachBubble
                record={activeRecord}
                onShowDemo={handleShowDemo}
                canShowDemo={canShowDemo(activeRecord)}
                onHoverInsight={setHoveredShapes}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Modals & Dialogs */}
      {showGameReview && (
        <div className="fixed inset-0 z-[150] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <GameReviewModal
            records={records}
            onSelectNode={handleNodeSelect}
            onStartRetry={startRetryBlunder}
            onClose={() => setShowGameReview(false)}
          />
        </div>
      )}

      {showReport && (
        <div className="fixed inset-0 z-[150] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <GameReport stats={stats} onClose={() => setShowReport(false)} />
        </div>
      )}

      {showImport && <PgnImportModal onImport={handleImportPgn} onClose={() => setShowImport(false)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {promotion && (
        <PromotionDialog
          from={promotion.from}
          to={promotion.to}
          color={fen.split(' ')[1] === 'w' ? 'white' : 'black'}
          onSelect={promotion.callback}
          onCancel={() => setPromotion(null)}
        />
      )}
    </div>
  );
}
