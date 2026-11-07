'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { ChessBoard, EvalGraph, EvalBar, MoveList, GameReport, Explorer, KeyMoments, CoachBubble, PgnImportModal, PromotionDialog, BoardDemo } from '@chess-analyzer/ui';
import { GameManager, MoveRecord, EvalNormalizer, MotifEngine, AccuracyScore, ExplorerService, ExplorerResult, PgnParser, pvToShape, CloudEvalService, GameEventBus, buildDemo, type DemoStep } from '@chess-analyzer/chess-core';
import { EngineEvaluation } from '@chess-analyzer/chess-core/src/events/GameEventBus';
import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';

const STORAGE_KEY = 'chess-analyzer:game';

type PromotionCallback = (piece: 'q' | 'r' | 'b' | 'n') => void;

export default function Home() {
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [records, setRecords] = useState<MoveRecord[]>([]);
  /**
   * État d'évaluation groupé : un seul objet → UN setState par frame.
   * Auparavant, 5 `setState` séparés étaient déclenchés à chaque ligne `info`
   * du moteur (des dizaines par seconde) → rendus React en cascade.
   */
  const [evalState, setEvalState] = useState<{
    winProb: number;
    cp?: number;
    mate?: number;
    depth: number;
    source?: 'cloud' | 'local';
    status: 'idle' | 'analyzing' | 'ready' | 'error';
  }>({ winProb: 0, cp: 0, depth: 0, status: 'idle' });
  const [shapes, setShapes] = useState<Array<{ orig: string; dest?: string; brush: string }>>([]);
  const [showReport, setShowReport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [threatMode, setThreatMode] = useState(false);
  /**
   * Lignes alternatives. Désactivé par défaut : MultiPV 3 coûte ~3× le temps
   * de recherche Stockfish. Quand c'est désactivé, seule la meilleure ligne
   * (flèche verte) est calculée et affichée.
   */
  const [showLines, setShowLines] = useState(false);
  /** Miroir de `showLines` lisible depuis l'effet à deps `[]`. */
  const showLinesRef = useRef(false);
  const [explorerData, setExplorerData] = useState<ExplorerResult>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<[string, string] | undefined>(undefined);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [notice, setNotice] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string; callback: PromotionCallback } | null>(null);
  /**
   * Démonstration sur l'échiquier : étapes + position de départ. Isolée de la
   * partie (le plateau réel n'est jamais modifié).
   */
  const [demo, setDemo] = useState<{ title: string; startFen: string; steps: DemoStep[] } | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'moves' | 'coach' | 'explorer'>('coach');
  const multiPvs = useRef<Map<number, EngineEvaluation>>(new Map());
  const threatPvs = useRef<Map<number, EngineEvaluation>>(new Map());
  const gmRef = useRef<GameManager | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Debounce des appels à la base Lichess (évite les rafales à la restauration). */
  const explorerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Tient l'eventBus pour les callbacks hors effet (fetch cloud). */
  const eventBusRef = useRef<GameEventBus | null>(null);

  // ---------------------------------------------------------------- throttles
  /**
   * Accumulateur d'évaluation : le handler moteur écrit ici sans déclencher de
   * rendu ; une seule frame (requestAnimationFrame) pousse le résultat dans
   * l'état React. ~60 setState/s au pire, au lieu d'un par ligne `info`.
   */
  const evalAccum = useRef<{ value: typeof evalState | null }>({ value: null });
  const evalRaf = useRef<number | null>(null);
  /** Flèches : 10 fps suffisent largement et évitent de repeindre l'échiquier. */
  const shapeAccum = useRef<{ value: Array<{ orig: string; dest?: string; brush: string }> | null }>({ value: null });
  const shapeRaf = useRef<number | null>(null);
  const lastShapeFlush = useRef(0);

  /** Planifie l'application de l'évaluation à la prochaine frame. */
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

  /** Planifie l'application des flèches (au plus toutes les 100 ms). */
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

  // ------------------------------------------------------- cache des motifs
  /**
   * `MotifEngine.detectUndefended` coûte ~0.6–1.2 ms (SEE récursif sur 64
   * cases). Elle ne dépend que du FEN, pas de la profondeur : on la mémoïse.
   */
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
      // Position illisible : pas de motifs plutôt qu'un crash.
    }
    motifCache.current = { fen: fenStr, shapes: out };
    return out;
  }, []);

  /** Requête la base d'ouvertures au plus toutes les 300 ms (la dernière gagne). */
  const fetchExplorerDebounced = useCallback((fen: string) => {
    if (explorerTimer.current) clearTimeout(explorerTimer.current);
    explorerTimer.current = setTimeout(() => {
      ExplorerService.fetch(fen).then(setExplorerData);
    }, 300);
  }, []);

  // --- Toast with auto-dismiss ---
  const showNotice = useCallback((msg: string, durationMs = 6000) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), durationMs);
  }, []);

  // --- Persistence: save/restore game to localStorage ---
  /**
   * Sauvegarde la partie. `localStorage` plafonne autour de 5 Mo : on ne
   * persiste donc PAS les fiches complètes (`coachCard`, PV, explications)
   * qui peuvent peser plusieurs centaines de Ko sur une longue partie, mais
   * uniquement les données nécessaires à la reconstruction et à l'affichage
   * des verdicts. Les fiches coach sont régénérées à la demande.
   *
   * En cas de dépassement de quota, on retente sans les records avant
   * d'abandonner — sinon un `setItem` qui throw laissait croire à une
   * sauvegarde réussie alors que rien n'était écrit.
   */
  const saveGame = useCallback(() => {
    const gm = gmRef.current;
    if (!gm) return;
    const uciMoves = gm.moveManager.getUciMoves();
    if (uciMoves.length === 0) {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      return;
    }

    const initialFen = gm.moveManager.getInitialFen();
    const records = gm.getMoveRecords();

    // Version allégée : on garde ce qui permet d'afficher les verdicts sans
    // rejouer l'analyse, mais on retire les gros champs texte.
    const slimRecords = records.map(r => ({
      ...r,
      coachCard: undefined,
      explanation: undefined,
      // Les PV complètes peuvent être longues ; le coup clé suffit.
      bestPv: undefined,
      refutationPv: undefined,
    }));

    const attempts: string[] = [
      JSON.stringify({ moves: uciMoves, records: slimRecords, initialFen, ts: Date.now() }),
      // Dernier recours : sans aucun record (la partie est rejouée/analysée).
      JSON.stringify({ moves: uciMoves, initialFen, ts: Date.now() }),
    ];

    for (const payload of attempts) {
      try {
        localStorage.setItem(STORAGE_KEY, payload);
        return;
      } catch {
        // QuotaExceededError : on tente la version suivante, plus légère.
      }
    }
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Debounce 1,5 s : `PedagogyUpdated` arrive au moins deux fois par coup
   * (record initial puis fiche coach enrichie). Sérialiser toute la partie à
   * chaque événement bloquait le thread principal.
   */
  const saveGameDebounced = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      saveGame();
    }, 1500);
  }, [saveGame]);

  const restoreGame = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const { moves, records: savedRecords, initialFen } = JSON.parse(raw) as {
        moves: string[];
        records?: MoveRecord[];
        initialFen?: string;
        ts: number;
      };
      if (!Array.isArray(moves) || moves.length === 0) return false;
      const gm = gmRef.current;
      if (!gm) return false;
      if (!gm.restoreSession(moves, savedRecords, initialFen)) return false;
      setRecords(gm.getMoveRecords());
      setActiveNodeId(gm.getActiveNodeId());
      return true;
    } catch {
      return false;
    }
  }, []);

  /** Surligne le dernier coup joué une fois la situation reconstruite. */
  const syncLastMoveFromBoard = useCallback(() => {
    const moves = gmRef.current?.moveManager.getUciMoves() ?? [];
    const last = moves.at(-1);
    setLastMove(last ? [last.slice(0, 2), last.slice(2, 4)] : undefined);
  }, []);

  /**
   * Cloud Eval (trio lila : nuage → explorer → Stockfish local). Le hit est
   * réinjecté dans le flux d'évaluations : flèches MultiPV et barre
   * s'affichent instantanément pendant que le local monte en profondeur.
   * Le pipeline ignore ces évals (jugement réservé au local, comme lila qui
   * ne juge pas avec evalCache).
   */
  const fetchCloudEvalDebounced = useCallback((fen: string) => {
    if (cloudTimer.current) clearTimeout(cloudTimer.current);
    cloudTimer.current = setTimeout(() => {
      CloudEvalService.fetch(fen, 3).then(evals => {
        if (!evals) return;
        // La position a pu changer pendant le vol : ne rejouer que du frais.
        const current = gmRef.current?.moveManager.getFen();
        for (const ev of evals) {
          if (current && ev.fen !== current) continue;
          eventBusRef.current?.emit('EngineEvaluationUpdated', ev);
        }
      });
    }, 250);
  }, []);

  useEffect(() => {
    const gm = new GameManager();
    const eventBus = gm.eventBus;
    gmRef.current = gm;
    eventBusRef.current = eventBus;

    eventBus.on('PedagogyUpdated', () => {
      const next = gm.getMoveRecords();
      // Évite de remplacer le tableau si le nombre de records n'a pas changé
      // ET que seule la fiche texte a été enrichie : sinon MoveList, EvalGraph
      // et KeyMoments se re-rendent pour rien.
      setRecords(prev => (prev.length === next.length && prev.at(-1)?.coachCard === next.at(-1)?.coachCard ? prev : next));
      saveGameDebounced();
    });

    eventBus.on('MovePlayed', ({ nodeId }) => setActiveNodeId(nodeId));
    eventBus.on('NavigateTo', ({ nodeId }) => setActiveNodeId(nodeId));

    eventBus.on('EngineEvaluationUpdated', (evaluation) => {
      multiPvs.current.set(evaluation.multiPv || 1, evaluation);

      if (!evaluation.multiPv || evaluation.multiPv === 1) {
        const currentFen = gmRef.current?.moveManager.getFen() ?? fen;
        if (evaluation.fen && evaluation.fen !== currentFen) return;
        const turn = currentFen.split(' ')[1] === 'w' ? 'white' : 'black';
        // `normalize` rend le cp POV Blanc (signe inversé pour les Noirs).
        const normCp = EvalNormalizer.normalize(evaluation.cp, evaluation.mate, turn);
        // Le mate affiché (`M3`) garde sa valeur brute signée manuellement :
        // `normalize` l'aurait replié à ±1000 (affiché +10.0 au lieu de M3).
        const sign = turn === 'white' ? 1 : -1;

        // Accumulation sans setState : un seul rendu par frame (voir scheduleEvalFlush).
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

      // Flèches MultiPV : la meilleure ligne en vert, les alternatives en bleu.
      // `pvToShape` gère les promotions (`e7e8q`).
      const newShapes: Array<{ orig: string; dest?: string; brush: string }> = [];
      const pv3 = multiPvs.current.get(3);
      const pv2 = multiPvs.current.get(2);
      const pv1 = multiPvs.current.get(1);

      // Les alternatives ne sont dessinées que si l'utilisateur les a demandées
      // (MultiPV 3 = 3× le coût de recherche, voir toggleLines).
      // `showLinesRef` : l'effet a des deps `[]`, lire l'état directement y
      // figerait la valeur initiale (false) pour toujours.
      const alternatives: Array<[EngineEvaluation | undefined, string]> = showLinesRef.current
        ? [[pv3, 'paleBlue'], [pv2, 'paleBlue']]
        : [];

      for (const [pv, brush] of [...alternatives, [pv1, 'paleGreen']] as Array<[EngineEvaluation | undefined, string]>) {
        const shape = pvToShape(pv?.pv, brush);
        if (shape) newShapes.push(shape);
      }

      // Motifs : mémoïsés par FEN (coût ~1 ms sinon, à chaque ligne `info`).
      const fenStr = gmRef.current?.moveManager.getFen() ?? fen;
      newShapes.push(...getMotifShapes(fenStr));

      shapeAccum.current.value = newShapes;
      scheduleShapeFlush();
    });

    eventBus.on('ThreatEvaluationUpdated', (evaluation) => {
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

    eventBus.on('AnalysisStarted', () => {
      // Un seul setState groupé (voir evalState) au lieu de deux.
      setEvalState(prev => ({ ...prev, depth: 0, status: 'analyzing' }));
    });

    eventBus.on('EngineError', (message) => {
      setEvalState(prev => ({ ...prev, status: 'error' }));
      showNotice(`Moteur Stockfish : ${message}`, 10000);
    });

    eventBus.on('PositionChanged', ({ fen }) => {
      multiPvs.current.clear();
      threatPvs.current.clear();
      // Le cache de motifs est indexé par FEN : il se renouvelle tout seul,
      // mais on libère l'entrée précédente pour ne pas garder de référence.
      motifCache.current = null;
      setFen(fen);
      setEvalState(prev => ({ ...prev, source: undefined }));
      fetchExplorerDebounced(fen);
      fetchCloudEvalDebounced(fen);
    });

    gm.init();

    // Restore previous session from localStorage. Différé d'un tick : la
    // restauration relit un système externe (localStorage + moteur) et ne doit
    // pas déclencher de rendu en cascade pendant le montage.
    const restoreTimer = setTimeout(() => {
      if (restoreGame()) {
        syncLastMoveFromBoard();
        showNotice('Partie précédente restaurée.', 3000);
      }
    }, 0);

    return () => {
      clearTimeout(restoreTimer);
      if (cloudTimer.current) clearTimeout(cloudTimer.current);
      if (explorerTimer.current) clearTimeout(explorerTimer.current);
      if (evalRaf.current !== null) cancelAnimationFrame(evalRaf.current);
      if (shapeRaf.current !== null) clearTimeout(shapeRaf.current);
      eventBusRef.current = null;
      gm.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Précision et ACPL calculés avec les formules exactes de Lichess
  // (`AccuracyPercent.gameAccuracy`, `AccuracyCP.mean`) : le rapport affiche
  // ainsi les mêmes chiffres que lichess.org pour la même partie.
  const stats = useMemo(() => {
    const base = AccuracyScore.computeGameStats(records);
    const lichess = AccuracyScore.computeLichessAccuracy(records, 'white');
    return {
      ...base,
      accuracy: {
        white: Math.round(lichess.white * 10) / 10,
        black: Math.round(lichess.black * 10) / 10,
      },
    };
  }, [records]);
  const activeRecord = useMemo(() => records.find(r => r.nodeId === activeNodeId), [records, activeNodeId]);
  const activeIndex = useMemo(() => (activeRecord ? records.indexOf(activeRecord) : undefined), [records, activeRecord]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const gm = gmRef.current;
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          gm?.navigatePrev();
          break;
        case 'ArrowRight':
          event.preventDefault();
          gm?.navigateNext();
          break;
        case 'ArrowUp':
          event.preventDefault();
          gm?.navigateFirst();
          break;
        case 'ArrowDown':
          event.preventDefault();
          gm?.navigateLast();
          break;
        case 'f':
        case 'F':
          setOrientation(prev => (prev === 'white' ? 'black' : 'white'));
          break;
        case 'Escape':
          setShowReport(false);
          setShowImport(false);
          setShowHelp(false);
          break;
        case '?':
          setShowHelp(prev => !prev);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleNodeSelect = useCallback((nodeId: string) => {
    gmRef.current?.navigateToNode(nodeId);
  }, []);

  // --- Promotion handling ---
  const handleMove = useCallback((from: string, to: string) => {
    const gm = gmRef.current;
    if (!gm) return;
    gm.pipeline.resetPending();

    // La logique de promotion vit dans MoveManager : elle se base sur les
    // coups réellement légaux, pas sur la rangée d'arrivée.
    if (gm.moveManager.isPromotion(from, to)) {
      setPromotion({
        from,
        to,
        callback: (piece: 'q' | 'r' | 'b' | 'n') => {
          if (gm.playMove(`${from}${to}${piece}`).success) {
            setLastMove([from, to]);
          }
          setPromotion(null);
        },
      });
      return;
    }

    if (gm.playMove(`${from}${to}`).success) {
      setLastMove([from, to]);
    }
  }, []);

  /**
   * Ouvre la démonstration d'une variante.
   *
   * Choix de la suite montrée :
   * - coup fautif → la **réfutation** (la réponse de l'adversaire depuis la
   *   position après le coup) : « voilà comment il peut vous punir » ;
   * - coup perfectible → la **meilleure ligne** depuis la position avant le
   *   coup : « voilà ce qu'il fallait jouer ».
   * Aucune invention : les coups viennent de l'analyse Stockfish (`refutationPv`
   * / `bestPv` du record).
   */
  const handleShowDemo = useCallback((record: MoveRecord) => {
    const isError =
      record.classification === 'inaccuracy' ||
      record.classification === 'mistake' ||
      record.classification === 'blunder';

    const refutation = record.refutationPv ?? [];
    const best = record.bestPv ?? [];

    let startFen = record.fenBefore;
    let pv = best;
    let title = 'Ce qu’il fallait jouer';

    if (isError && refutation.length > 0) {
      startFen = record.fenAfter;
      pv = refutation;
      title = 'Comment l’adversaire peut en profiter';
    } else if (best.length === 0) {
      showNotice('Pas de suite de coups disponible pour ce coup.', 4000);
      return;
    }

    const steps = buildDemo(startFen, pv, 6);
    if (steps.length === 0) {
      showNotice('Démonstration indisponible pour cette position.', 4000);
      return;
    }

    setDemo({ title, startFen, steps });
  }, [showNotice]);

  /** Une démo est-elle possible pour ce record ? */
  const canShowDemo = useCallback((record?: MoveRecord) => {
    if (!record) return false;
    const hasRefutation = (record.refutationPv?.length ?? 0) > 0;
    const hasBest = (record.bestPv?.length ?? 0) > 0;
    return hasRefutation || hasBest;
  }, []);

  const handleExplorerMove = useCallback((move: { san: string; uci: string }) => {
    if (!move.uci) return;
    setLastMove([move.uci.slice(0, 2), move.uci.slice(2, 4)]);
    gmRef.current?.playMove(move.uci);
  }, []);

  /**
   * Active/désactive les 3 meilleures lignes. Le MultiPV du moteur suit
   * immédiatement (setoption), puis l'analyse de la position courante est
   * relancée pour peupler les flèches.
   */
  const toggleLines = useCallback(() => {
    setShowLines(prev => {
      const next = !prev;
      showLinesRef.current = next;
      const engine = gmRef.current?.engineManager;
      if (!engine) return next;
      engine.setMultiPv(next ? 3 : 1);
      if (!next) {
        // Purge les PV secondaires : leurs flèches ne doivent plus s'afficher.
        multiPvs.current.delete(2);
        multiPvs.current.delete(3);
        setShapes(prevShapes => prevShapes.filter(s => s.brush !== 'paleBlue'));
      }
      // Relance pour que le moteur applique le nouveau MultiPV immédiatement.
      const currentFen = gmRef.current?.moveManager.getFen();
      if (currentFen) engine.analyze(currentFen, 14);
      return next;
    });
  }, []);

  const toggleThreatMode = useCallback(() => {    setThreatMode(prev => {
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
    if (records.length === 0) {
      showNotice('Aucun coup à exporter : jouez ou importez une partie.');
      return;
    }
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
    showNotice('PGN exporté.');
  }, [records, showNotice]);

  const handleImportPgn = useCallback((pgnText: string) => {
    if (!pgnText || !gmRef.current) return;
    setShowImport(false);
    showNotice('Analyse de la partie en cours…', 15000);
    gmRef.current.loadPgn(pgnText).then(result => {
      if (result.success) {
        setActiveNodeId(gmRef.current?.getActiveNodeId() ?? null);
        syncLastMoveFromBoard();
        setThreatMode(false);
        showNotice(`Partie chargée : ${result.moveCount ?? 0} coups analysés.`);
      } else {
        showNotice(`Import PGN impossible : ${result.error ?? 'format non reconnu'}`, 8000);
      }
    });
  }, [showNotice, syncLastMoveFromBoard]);

  const handleReset = useCallback(() => {
    const gm = gmRef.current;
    if (!gm) return;
    gm.resetGame();
    setActiveNodeId(null);
    setLastMove(undefined);
    setRecords([]);
    setThreatMode(false);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    showNotice('Nouvelle partie.', 3000);
  }, [showNotice]);

  const depthLabel = useMemo(() => {
    if (evalState.status === 'error') return 'Erreur';
    if (evalState.status === 'idle' || evalState.depth === 0) return 'Initialisation…';
    // showingCloud de lila : quand le dernier eval affiché vient du nuage,
    // on le dit explicitement tant que le local n'a pas rattrapé la profondeur.
    if (evalState.source === 'cloud') return `Nuage · profondeur ${evalState.depth}`;
    if (evalState.depth >= 14) return `Profondeur ${evalState.depth}`;
    return `Profondeur ${evalState.depth}/14`;
  }, [evalState.status, evalState.depth, evalState.source]);

  return (
    <div className="min-h-screen w-full flex flex-col">
      {/* === Top Navigation Bar === */}
      <nav className="sticky top-0 z-50 glass-panel border-b border-slate-700/50 px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 bg-indigo-500/20 rounded-lg flex items-center justify-center ring-1 ring-indigo-500/30">
            <span className="text-lg">&#9822;</span>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-bold text-slate-100 leading-tight">Chess Analyzer</h1>
            <p className="text-[10px] text-indigo-400/70 leading-tight">Coach IA d&apos;échecs</p>
          </div>
        </div>

        {/* Engine status indicator */}
        <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 glass-panel-light rounded-lg px-3 py-1.5" title={evalState.source === 'cloud' ? 'Évaluation depuis le nuage de Lichess' : 'Analyse Stockfish locale'}>
          <span className={`w-2 h-2 rounded-full ${evalState.status === 'error' ? 'bg-red-400' : evalState.source === 'cloud' ? 'bg-sky-400' : evalState.status === 'ready' ? 'bg-green-400' : evalState.status === 'analyzing' ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'}`} />
          <span className="font-mono">{depthLabel}</span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-1.5 bg-slate-800/70 hover:bg-slate-700 rounded-lg text-xs sm:text-sm font-medium transition-colors border border-slate-700/50 flex items-center gap-1.5 text-slate-300 hover:text-white"
            title="Importer une partie PGN"
            aria-label="Importer PGN"
          >
            <span>&#128194;</span>
            <span className="hidden sm:inline">Importer</span>
          </button>
          <button
            onClick={handleExportPgn}
            className="px-3 py-1.5 bg-slate-800/70 hover:bg-slate-700 rounded-lg text-xs sm:text-sm font-medium transition-colors border border-slate-700/50 flex items-center gap-1.5 text-slate-300 hover:text-white"
            title="Exporter en PGN"
            aria-label="Exporter PGN"
          >
            <span>&#128190;</span>
            <span className="hidden sm:inline">Exporter</span>
          </button>
          <button
            onClick={handleReset}
            className="px-3 py-1.5 bg-slate-800/70 hover:bg-red-900/40 rounded-lg text-xs sm:text-sm font-medium transition-colors border border-slate-700/50 flex items-center gap-1.5 text-slate-300 hover:text-red-300"
            title="Nouvelle partie"
            aria-label="Nouvelle partie"
          >
            <span>&#8635;</span>
            <span className="hidden sm:inline">Recommencer</span>
          </button>
          <button
            onClick={() => setShowHelp(true)}
            className="px-2.5 py-1.5 bg-slate-800/70 hover:bg-slate-700 rounded-lg text-sm font-bold transition-colors border border-slate-700/50 text-slate-400 hover:text-white"
            title="Aide & raccourcis (touche ?)"
            aria-label="Aide"
          >
            ?
          </button>
        </div>
      </nav>

      {/* === Toast === */}
      {notice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] max-w-lg w-[90%] glass-panel rounded-lg px-4 py-2.5 text-sm text-slate-200 flex items-center gap-3 shadow-2xl">
          <span className="flex-1">{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="text-slate-400 hover:text-white transition-colors shrink-0"
            aria-label="Fermer la notification"
          >
            &#10005;
          </button>
        </div>
      )}

      {/* === Main Content === */}
      <main className="flex-1 w-full max-w-[1450px] mx-auto p-3 sm:p-4 xl:p-6">
        <div className="flex flex-col xl:flex-row gap-4 xl:gap-6 items-start justify-center">

          {/* --- Left Col: Board + EvalBar + Graph --- */}
          <div className="flex flex-col gap-3 sm:gap-4 w-full xl:w-auto xl:shrink-0">            {/* Board area */}
            <div className="flex gap-2 sm:gap-3">
              <EvalBar winProb={evalState.winProb} cp={evalState.cp} mate={evalState.mate} orientation={orientation} />
              <div className="relative flex-1 aspect-square max-w-[600px] shadow-2xl rounded-xl overflow-hidden border border-slate-800 ring-1 ring-white/10">
                <ChessBoard
                  fen={fen}
                  onMove={handleMove}
                  shapes={shapes}
                  lastMove={lastMove}
                  orientation={orientation}
                />
              </div>
            </div>

            {/* Secondary controls row (also hosts the mobile panel tabs) */}
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setShowReport(true)} className="flex-1 min-w-[100px] px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors shadow-lg flex items-center gap-2 justify-center text-white border border-indigo-400/30">
                <span>&#128202;</span> Bilan
              </button>
              <button
                onClick={toggleThreatMode}
                className={`flex-1 min-w-[100px] px-3 py-2 rounded-lg text-sm font-medium transition-colors border flex items-center gap-2 justify-center ${threatMode ? 'bg-red-500/20 text-red-300 border-red-500/50' : 'hover:bg-slate-800/60 text-slate-300 border-slate-700/50'}`}
              >
                <span>&#128680;</span> Menaces
              </button>
              <button
                onClick={toggleLines}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors border flex items-center gap-1.5 justify-center ${showLines ? 'bg-sky-500/20 text-sky-300 border-sky-500/50' : 'bg-slate-800/70 hover:bg-slate-700 text-slate-300 border-slate-700/50'}`}
                title="Afficher les 3 meilleures lignes (plus lent)"
                aria-pressed={showLines}
              >
                <span>&#9776;</span>
                <span className="hidden sm:inline text-xs">Lignes</span>
              </button>
              <button onClick={() => setOrientation(o => o === 'white' ? 'black' : 'white')} className="px-3 py-2 bg-slate-800/70 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-700/50 text-slate-300 hover:text-white" title="Retourner l'échiquier (F)">
                <span>&#8634;</span>
              </button>
            </div>

            {/* Mobile panel tabs: BELOW the board so they never intercept drags
                on the bottom-center squares (d1/e1/d2/e2). */}
            <div className="xl:hidden flex gap-1 glass-panel rounded-lg p-1">
              {(['coach', 'moves', 'explorer'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setMobilePanel(p)}
                  aria-pressed={mobilePanel === p}
                  className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${mobilePanel === p ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  {p === 'coach' ? 'Coach' : p === 'moves' ? 'Coups' : 'Base'}
                </button>
              ))}
            </div>

            {/* Graph + Key Moments */}
            <div className="flex gap-3 w-full h-[120px] sm:h-[150px]">
              <div className="flex-1 glass-panel rounded-xl overflow-hidden p-2 sm:p-3 relative">
                <EvalGraph
                  records={records}
                  activeIndex={activeIndex}
                  onNodeClick={(index) => {
                    const node = records[index];
                    if (node) handleNodeSelect(node.nodeId);
                  }}
                />
              </div>
              <div className="w-[160px] sm:w-[200px] shrink-0">
                <KeyMoments records={records} onNodeSelect={handleNodeSelect} />
              </div>
            </div>
          </div>

          {/* --- Middle Col: MoveList + Explorer.
              Mobile : l'onglet « Coups » montre la liste, l'onglet « Base »
              montre l'explorer (avant, il était inaccessible : enfermé dans
              la colonne « Coups » tout en n'étant visible que sur « Base »).
              Desktop : les deux, comme avant. --- */}
          <div
            className={`${mobilePanel === 'moves' || mobilePanel === 'explorer' ? 'flex' : 'hidden'} xl:flex flex-col gap-4 w-full xl:w-[300px] xl:shrink-0`}
          >
            <div className={`${mobilePanel === 'moves' ? 'block' : 'hidden'} xl:block h-[380px] xl:h-[460px]`}>
              <MoveList
                records={records}
                activeIndex={activeIndex}
                onNodeClick={(index) => {
                  const node = records[index];
                  if (node) handleNodeSelect(node.nodeId);
                }}
              />
            </div>
            <div className={`${mobilePanel === 'explorer' ? 'block' : 'hidden'} xl:block h-[280px] glass-panel-light rounded-xl overflow-hidden relative`}>
              <Explorer data={explorerData} onMoveSelect={handleExplorerMove} />
            </div>
          </div>

          {/* --- Right Col: Coach --- */}
          <div className={`${mobilePanel === 'coach' ? 'flex' : 'hidden'} xl:flex flex-col gap-4 w-full xl:w-[400px] xl:shrink-0`}>
            <div className="min-h-[300px] xl:min-h-[420px]">
              <CoachBubble record={activeRecord} onShowDemo={handleShowDemo} canShowDemo={canShowDemo(activeRecord)} />
            </div>
          </div>

        </div>
      </main>

      {/* === Rapport de partie : overlay plein écran, comme les autres modals
          (il était piégé dans le carré du plateau, écrasé à 600 px) === */}
      {showReport && (
        <div className="fixed inset-0 z-[150] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <GameReport stats={stats} onClose={() => setShowReport(false)} />
        </div>
      )}

      {/* === Modals === */}
      {showImport && (
        <PgnImportModal
          onImport={handleImportPgn}
          onClose={() => setShowImport(false)}
        />
      )}

      {demo && (
        <BoardDemo
          title={demo.title}
          startFen={demo.startFen}
          steps={demo.steps}
          onClose={() => setDemo(null)}
        />
      )}

      {showHelp && (
        <HelpModal onClose={() => setShowHelp(false)} />
      )}

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

// --- Help Modal ---
function HelpModal({ onClose }: { onClose: () => void }) {
  const shortcuts: Array<[string, string]> = [
    ['←', 'Coup précédent'],
    ['→', 'Coup suivant'],
    ['↑', 'Début de la partie'],
    ['↓', 'Fin de la partie'],
    ['F', 'Retourner l\'échiquier'],
    ['?', 'Ouvrir / fermer cette aide'],
    ['Esc', 'Fermer le dialogue actif'],
  ];
  const badges: Array<[string, string, string]> = [
    ['!!', 'Brillant', 'text-teal-300'],
    ['!', 'Superbe', 'text-blue-300'],
    ['★', 'Meilleur coup', 'text-green-400'],
    ['', 'Bon', 'text-green-300'],
    ['?!', 'Imprécision', 'text-yellow-300'],
    ['?', 'Erreur', 'text-orange-400'],
    ['??', 'Gaffe', 'text-red-400'],
  ];
  return (
    <div className="fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel rounded-2xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto custom-scrollbar" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <span>&#128161;</span> Aide & Raccourcis
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl" aria-label="Fermer">&#10005;</button>
        </div>

        <h3 className="text-sm font-semibold text-slate-300 mb-2">Raccourcis clavier</h3>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {shortcuts.map(([key, action]) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              <kbd className="px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs font-mono text-slate-200 min-w-[28px] text-center">{key}</kbd>
              <span className="text-slate-400">{action}</span>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-semibold text-slate-300 mb-2">Classification des coups</h3>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {badges.map(([icon, label, color]) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <span className={`font-bold ${color} w-8 text-center`}>{icon}</span>
              <span className="text-slate-400">{label}</span>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-semibold text-slate-300 mb-2">Conseils</h3>
        <ul className="text-sm text-slate-400 space-y-1.5 list-disc list-inside">
          <li>Jouez un coup ou importez un PGN pour lancer l&apos;analyse.</li>
          <li>Les <span className="text-green-400">flèches vertes</span> indiquent le meilleur coup selon Stockfish.</li>
          <li>Les <span className="text-red-400">cercles rouges</span> signalent les pièces en prise non défendues.</li>
          <li>Les <span className="text-blue-400">cercles bleus</span> montrent les pièces clouées.</li>
          <li>Le coach IA explique chaque coup en langage naturel.</li>
          <li>Votre partie est sauvegardée automatiquement dans votre navigateur.</li>
        </ul>
      </div>
    </div>
  );
}
