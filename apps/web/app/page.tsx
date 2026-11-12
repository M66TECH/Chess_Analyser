'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faCircleInfo } from '@fortawesome/free-solid-svg-icons';
import { CoachBubble, SoundService, SpeechService } from '@chess-analyzer/ui';
import {
  GameManager,
  MoveRecord,
  MoveNode,
  AccuracyScore,
  MatchSummaryService,
  PgnParser,
  buildDemo,
  evaluateRetryMove,
  uciToShape,
  serializeGame,
  parseStoredGame,
  GAME_STORE_KEY,
  type DemoStep,
  type PlayerLevel,
} from '@chess-analyzer/chess-core';
import { NavigationBar } from './components/NavigationBar';
import { MobileNavigationTabs, type MobilePanelTab } from './components/MobileNavigationTabs';
import { BoardArea } from './components/BoardArea';
import { ControlsRow } from './components/ControlsRow';
import { AnalysisRail } from './components/AnalysisRail';
import { ModalsHost } from './components/ModalsHost';
import { hoverStore } from './stores/hoverStore';
import { useEngineAnalysis } from './hooks/useEngineAnalysis';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

type PromotionCallback = (piece: 'q' | 'r' | 'b' | 'n') => void;

export default function Home() {
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [previewFen, setPreviewFen] = useState<string | null>(null);
  const [records, setRecords] = useState<MoveRecord[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
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
  const [playerLevel, setPlayerLevelState] = useState<PlayerLevel>('intermediaire');
  const playerLevelRef = useRef<PlayerLevel>(playerLevel);

  useEffect(() => {
    playerLevelRef.current = playerLevel;
  }, [playerLevel]);

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

  // Sound state & player preferences sync (O14 / O15)
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSoundEnabled(SoundService.getInstance().isEnabled());
    try {
      const raw = localStorage.getItem('ca:prefs');
      if (raw) {
        const prefs = JSON.parse(raw);
        if (prefs && (prefs.playerLevel === 'debutant' || prefs.playerLevel === 'intermediaire' || prefs.playerLevel === 'avance')) {
          setPlayerLevelState(prefs.playerLevel);
          gmRef.current?.setPlayerLevel(prefs.playerLevel);
        }
        if (prefs?.orientation === 'white' || prefs?.orientation === 'black') {
          setOrientation(prefs.orientation);
        }
        if (typeof prefs?.soundEnabled === 'boolean') {
          if (SoundService.getInstance().isEnabled() !== prefs.soundEnabled) {
            SoundService.getInstance().toggle();
            setSoundEnabled(prefs.soundEnabled);
          }
        }
      }
    } catch {}
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const updatePref = useCallback((key: string, value: unknown) => {
    try {
      const raw = localStorage.getItem('ca:prefs');
      const prefs = raw ? JSON.parse(raw) : {};
      prefs[key] = value;
      localStorage.setItem('ca:prefs', JSON.stringify(prefs));
    } catch {}
  }, []);

  const handleChangePlayerLevel = useCallback((lvl: PlayerLevel) => {
    setPlayerLevelState(lvl);
    gmRef.current?.setPlayerLevel(lvl);
    updatePref('playerLevel', lvl);
  }, [updatePref]);

  const handleToggleSound = useCallback(() => {
    const next = SoundService.getInstance().toggle();
    setSoundEnabled(next);
    updatePref('soundEnabled', next);
  }, [updatePref]);

  const handleFlipOrientation = useCallback(() => {
    setOrientation((prev) => {
      const next = prev === 'white' ? 'black' : 'white';
      updatePref('orientation', next);
      return next;
    });
  }, [updatePref]);

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
      console.warn('[restoreGame]', parsed.error);
      showNotice(`Sauvegarde illisible : ${parsed.error ?? 'format inconnu'}`, 8000);
      return false;
    }

    const gm = gmRef.current;
    if (!gm) return false;
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

    const unsubPedagogy = eventBus.on('PedagogyUpdated', (updatedRecord) => {
      const next = gm.getMoveRecords();
      setRecords((prev) => {
        if (prev.length !== next.length) return next;
        const idx = next.findIndex((r) => r.nodeId === updatedRecord.nodeId);
        if (idx !== -1 && prev[idx]?.coachCard === next[idx]?.coachCard) return prev;
        return next;
      });
      saveGameDebounced();
    });

    const unsubMove = eventBus.on('MovePlayed', ({ nodeId }) => {
      setTreeNodes(new Map(gm.getTree().nodes));
      setActiveNodeId(nodeId);
      hoverStore.setShapes(null);
    });
    const unsubNav = eventBus.on('NavigateTo', ({ nodeId }) => {
      setActiveNodeId(nodeId);
      hoverStore.setShapes(null);
      if (!nodeId) {
        setLastMove(undefined);
      } else {
        const node = gm.getTree().nodes.get(nodeId);
        setLastMove(node ? [node.uci.slice(0, 2), node.uci.slice(2, 4)] : undefined);
      }
    });
    const cleanupEngine = setupEngineListeners(gm);

    gm.setPlayerLevel?.(playerLevelRef.current);
    gm.init();

    const restoreTimer = setTimeout(() => {
      // 1. Priorité aux paramètres d'URL (partage direct de position ou partie)
      if (typeof window !== 'undefined' && window.location.search) {
        try {
          const params = new URLSearchParams(window.location.search);
          const fenParam = params.get('fen');
          const pgnParam = params.get('pgn');
          if (fenParam) {
            const decodedFen = decodeURIComponent(fenParam).trim();
            if (decodedFen) {
              gm.resetGame(decodedFen);
              setRecords([]);
              setTreeNodes(new Map());
              setActiveNodeId(null);
              setLastMove(undefined);
              setFen(decodedFen);
              showNotice('Position chargée depuis le lien partagé.', 4000);
              return;
            }
          } else if (pgnParam) {
            const decodedPgn = decodeURIComponent(pgnParam).trim();
            if (decodedPgn) {
              showNotice('Analyse de la partie partagée en cours…', 10000);
              gm.loadPgn(decodedPgn).then((res) => {
                if (res.success) {
                  setRecords(gm.getMoveRecords());
                  setTreeNodes(new Map(gm.getTree().nodes));
                  setActiveNodeId(gm.getActiveNodeId());
                  syncLastMoveFromBoard();
                  showNotice('Partie chargée depuis le lien partagé.', 4000);
                }
              });
              return;
            }
          }
        } catch {}
      }

      // 2. Restauration de session locale si aucun paramètre URL
      if (restoreGame()) {
        syncLastMoveFromBoard();
        showNotice('Partie précédente restaurée.', 3000);
      }
    }, 0);

    return () => {
      clearTimeout(restoreTimer);
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
        noticeTimer.current = null;
      }
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      unsubPedagogy?.();
      unsubMove?.();
      unsubNav?.();
      cleanupEngine();
      gm.terminate();
    };
  }, [restoreGame, saveGameDebounced, setupEngineListeners, showNotice, syncLastMoveFromBoard]);

  // Stats calculation
  const stats = useMemo(() => {
    const summary = MatchSummaryService.generateSummary(records);
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
    if (activeNodeId === null) return undefined;
    const idx = records.findIndex((r) => r.nodeId === activeNodeId);
    return idx === -1 ? (records.length > 0 ? records.length - 1 : undefined) : idx;
  }, [records, activeNodeId]);

  const activeRecord = useMemo(() => {
    if (activeIndex === undefined || activeIndex < 0 || activeIndex >= records.length) return undefined;
    return records[activeIndex];
  }, [records, activeIndex]);

  const handleToggleSpeech = useCallback(() => {
    if (!activeRecord || !activeRecord.coachCard) return;
    const card = activeRecord.coachCard;
    const parts: string[] = [];
    if (card.headline) parts.push(card.headline);
    for (const insight of card.insights) {
      parts.push(insight.text);
    }
    if (card.takeaway) {
      parts.push(`À retenir : ${card.takeaway}`);
    }
    if (parts.length > 0) {
      SpeechService.getInstance().toggle(parts.join(' '));
    }
  }, [activeRecord]);

  const handleSharePosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('pgn');
      url.searchParams.set('fen', fen);
      navigator.clipboard.writeText(url.toString()).then(
        () => showNotice('Lien direct de la position copié dans le presse-papier !', 4000),
        () => showNotice('Impossible de copier le lien dans le presse-papier.', 3000)
      );
    } catch {
      showNotice('Impossible de générer le lien de partage.', 3000);
    }
  }, [fen, showNotice]);

  // Hook 2: Keyboard shortcuts
  useKeyboardShortcuts(
    useMemo(
      () => ({
        onPrev: () => gmRef.current?.navigatePrev(),
        onNext: () => gmRef.current?.navigateNext(),
        onFirst: () => gmRef.current?.navigateFirst(),
        onLast: () => gmRef.current?.navigateLast(),
        onFlipBoard: handleFlipOrientation,
        onCloseModals: () => {
          setShowReport(false);
          setShowImport(false);
          setShowHelp(false);
          setShowGameReview(false);
          setRetryState(null);
          setRetryFen(null);
        },
        onToggleHelp: () => setShowHelp((h) => !h),
        onToggleSpeech: handleToggleSpeech,
      }),
      [handleFlipOrientation, handleToggleSpeech]
    ),
    !demo
  );

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
    hoverStore.setShapes(null);
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
    if (activeRecord && activeRecord.bestMove && !shapes.some((s) => s.brush === 'green')) {
      const best = uciToShape(activeRecord.bestMove);
      if (best) {
        return [...shapes, { ...best, brush: 'green' }];
      }
    }
    return shapes;
  }, [retryState, shapes, activeRecord]);

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

      const steps = buildDemo(startFen, pv);
      if (steps.length === 0) {
        showNotice('Impossible de construire la démonstration.', 4000);
        return;
      }

      const title = isPunish
        ? `Pourquoi ${record.san} était risqué`
        : `Ce que ${record.san} préparait`;

      setDemo({
        title,
        startFen,
        steps,
        mode,
        hasBothModes: hasRefutation && hasBest,
        record,
      });
      setDemoIndex(0);
      setIsDemoPlaying(false);
      setOrientation(record.color);
    },
    [showNotice]
  );

  const canShowDemo = useCallback((record?: MoveRecord): boolean => {
    if (!record) return false;
    const hasBest = Boolean((record.bestPv && record.bestPv.length > 0) || record.bestMove);
    const hasRefutation = Boolean(record.refutationPv && record.refutationPv.length > 0);
    return hasBest || hasRefutation;
  }, []);

  const handleCloseDemo = useCallback(() => {
    if (demoAutoPlayTimer.current) clearTimeout(demoAutoPlayTimer.current);
    demoAutoPlayTimer.current = null;
    setIsDemoPlaying(false);
    setDemo(null);
    setDemoIndex(-1);
    syncLastMoveFromBoard();
  }, [syncLastMoveFromBoard]);

  const handleNextDemoStep = useCallback(() => {
    if (!demo) return;
    setDemoIndex((idx) => {
      const next = idx + 1;
      if (next >= demo.steps.length) {
        setIsDemoPlaying(false);
        return idx;
      }
      return next;
    });
  }, [demo]);

  const handlePrevDemoStep = useCallback(() => {
    if (!demo) return;
    setDemoIndex((idx) => Math.max(0, idx - 1));
  }, [demo]);

  const handleGoToDemoStep = useCallback(
    (index: number) => {
      if (!demo || index < 0 || index >= demo.steps.length) return;
      setDemoIndex(index);
    },
    [demo]
  );

  useEffect(() => {
    if (!isDemoPlaying || !demo) return;
    if (demoIndex >= demo.steps.length - 1) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setIsDemoPlaying(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    demoAutoPlayTimer.current = setTimeout(() => {
      handleNextDemoStep();
    }, 1800);

    return () => {
      if (demoAutoPlayTimer.current) clearTimeout(demoAutoPlayTimer.current);
    };
  }, [isDemoPlaying, demoIndex, demo, handleNextDemoStep]);

  const demoStep = demo && demoIndex >= 0 ? demo.steps[demoIndex] : null;
  const demoFen = demoStep ? demoStep.fen : demo ? demo.startFen : null;
  const demoLastMove: [string, string] | undefined = demoStep
    ? [demoStep.uci.slice(0, 2), demoStep.uci.slice(2, 4)]
    : undefined;

  const demoShapes = useMemo(() => {
    if (!demoStep) return undefined;
    const shape = uciToShape(demoStep.uci);
    return shape ? [{ ...shape, brush: 'paleGreen' }] : undefined;
  }, [demoStep]);

  const handleExportPgn = useCallback(() => {
    const gm = gmRef.current;
    if (!gm) return;
    const pgn = PgnParser.exportAnnotatedPgn(records, gm.getTree());
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `partie-${new Date().toISOString().slice(0, 10)}.pgn`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotice('Partie exportée en PGN.', 3000);
  }, [records, showNotice]);

  const handleImportPgn = useCallback(
    (pgnText: string) => {
      if (!pgnText || !gmRef.current) return;
      setShowImport(false);
      showNotice('Analyse de la partie en cours…', 15000);
      gmRef.current.loadPgn(pgnText).then((result) => {
        if (result.success) {
          const gm = gmRef.current;
          if (gm) {
            setRecords(gm.getMoveRecords());
            setTreeNodes(new Map(gm.getTree().nodes));
            setActiveNodeId(gm.getActiveNodeId());
          }
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
      {/* O16/O17 : Annonces vocales pour les lecteurs d'écran */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {activeRecord
          ? `Coup ${activeRecord.san}, ${activeRecord.classification}. ${activeRecord.coachCard?.headline ?? ''}`
          : ''}
      </div>

      <NavigationBar
        depthLabel={depthLabel}
        engineStatus={evalState.status}
        engineSource={evalState.source}
        soundEnabled={soundEnabled}
        playerLevel={playerLevel}
        onChangePlayerLevel={handleChangePlayerLevel}
        onToggleSound={handleToggleSound}
        onImport={() => setShowImport(true)}
        onExport={handleExportPgn}
        onReset={handleReset}
        onHelp={() => setShowHelp(true)}
      />

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] max-w-md w-[92%] glass-panel rounded-xl px-4 py-3 text-sm text-slate-100 flex items-center gap-3 shadow-2xl border border-indigo-500/40"
        >
          <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
            <FontAwesomeIcon icon={faCircleInfo} className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <span className="flex-1 font-medium">{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="text-slate-400 hover:text-white transition-colors shrink-0 p-1 rounded-md hover:bg-slate-800/80"
            aria-label="Fermer la notification"
          >
            <FontAwesomeIcon icon={faXmark} className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <main className="flex-1 w-full max-w-[1450px] mx-auto p-3 sm:p-4 xl:p-6">
        <div className="flex flex-col xl:flex-row gap-4 xl:gap-6 items-start justify-center">
          {/* Colonne gauche : Plateau, évaluation, contrôles, graphe */}
          <div className="flex flex-col gap-3 sm:gap-4 w-full xl:w-auto xl:shrink-0">
            <BoardArea
              fen={demoFen ?? retryFen ?? previewFen ?? fen}
              onMove={demo ? undefined : handleMove}
              shapes={demoShapes ?? boardShapes}
              lastMove={demoLastMove ?? lastMove}
              orientation={orientation}
              interactive={!demo && !previewFen}
              evalState={evalState}
              retryState={retryState}
              onRevealRetry={() => setRetryState((prev) => (prev ? { ...prev, revealed: true } : null))}
              onResetRetry={() => {
                if (retryState) {
                  setRetryFen(retryState.blunderRecord.fenBefore);
                  setRetryState((prev) => (prev ? { ...prev, status: 'idle', revealed: false } : null));
                }
              }}
              onCloseRetry={cancelRetry}
              demo={demo}
              demoIndex={demoIndex}
              isDemoPlaying={isDemoPlaying}
              onSwitchDemoMode={(newMode) => handleShowDemo(demo!.record, newMode)}
              onNextDemoStep={handleNextDemoStep}
              onPrevDemoStep={handlePrevDemoStep}
              onToggleDemoPlay={() => setIsDemoPlaying((p) => !p)}
              onResetDemo={() => {
                setDemoIndex(-1);
                setIsDemoPlaying(false);
              }}
              onGoToDemoStep={handleGoToDemoStep}
              onCloseDemo={handleCloseDemo}
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
              onSelectNode={handleNodeSelect}
              onStartRetryBlunder={startRetryBlunder}
              onStartReview={() => setShowGameReview(true)}
            />

            <ControlsRow
              threatMode={threatMode}
              showLines={showLines}
              canPrev={Boolean(activeIndex !== undefined && activeIndex > 0)}
              canNext={Boolean(activeIndex !== undefined && activeIndex < records.length - 1)}
              onFirst={() => gmRef.current?.navigateFirst()}
              onPrev={() => gmRef.current?.navigatePrev()}
              onNext={() => gmRef.current?.navigateNext()}
              onLast={() => gmRef.current?.navigateLast()}
              onStartReview={() => setShowGameReview(true)}
              onOpenReport={() => setShowReport(true)}
              onToggleThreatMode={toggleThreatMode}
              onToggleLines={toggleLines}
              onFlipBoard={handleFlipOrientation}
              onShare={handleSharePosition}
            />

            <MobileNavigationTabs activePanel={mobilePanel} onSelectPanel={setMobilePanel} />
          </div>

          {/* Colonne du milieu : Coups + Explorateur */}
          <AnalysisRail
            mobilePanel={mobilePanel}
            treeNodes={treeNodes}
            records={records}
            activeNodeId={activeNodeId}
            activeIndex={activeIndex}
            explorerData={explorerData}
            onSelectNode={handleNodeSelect}
            onExplorerMove={handleExplorerMove}
          />

          {/* Colonne droite : Coach */}
          <div className={`${mobilePanel === 'coach' ? 'flex' : 'hidden'} xl:flex flex-col gap-4 w-full xl:w-[400px] xl:shrink-0`}>
            <div className="min-h-[300px] xl:min-h-[420px]">
              <CoachBubble
                record={activeRecord}
                onShowDemo={handleShowDemo}
                canShowDemo={canShowDemo(activeRecord)}
                onHoverInsight={hoverStore.setShapes}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Hôte accessible des modales & boîtes de dialogue (O13) */}
      <ModalsHost
        showGameReview={showGameReview}
        showReport={showReport}
        showImport={showImport}
        showHelp={showHelp}
        records={records}
        stats={stats}
        promotion={promotion}
        fen={fen}
        onSelectNode={handleNodeSelect}
        onStartRetry={startRetryBlunder}
        onCloseGameReview={() => setShowGameReview(false)}
        onCloseReport={() => setShowReport(false)}
        onCloseImport={() => setShowImport(false)}
        onCloseHelp={() => setShowHelp(false)}
        onImportPgn={handleImportPgn}
        onCancelPromotion={() => setPromotion(null)}
      />
    </div>
  );
}
