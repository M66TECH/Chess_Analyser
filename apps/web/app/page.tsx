"use client";
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  GameManager,
  HeatmapData,
  EngineEvaluation,
  MoveAnalysis,
  MoveRecord,
  MoveClassification,
  GameAccuracy,
  AccuracyCalculator,
} from '@chess-analyzer/chess-core';
import {
  EvalBar,
  BoardOverlay,
  HeatmapLayer,
  ThreatLayer,
  MoveList,
  EvalGraph,
} from '@chess-analyzer/ui';

const ChessBoard = dynamic(
  () => import('@chess-analyzer/ui').then((mod) => mod.ChessBoard),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full flex items-center justify-center bg-slate-900/50 rounded-xl text-slate-500 animate-pulse text-sm">
        Chargement de l'échiquier…
      </div>
    ),
  }
);

// ─── Classification config ─────────────────────────────────────
const CLASS_CONFIG: Record<MoveClassification, { label: string; color: string; badge: string }> = {
  brilliant:  { label: '!! Brillant',   color: '#a855f7', badge: 'badge-brilliant' },
  great:      { label: '! Excellent',   color: '#38bdf8', badge: 'badge-great' },
  best:       { label: '✓ Meilleur',    color: '#22c55e', badge: 'badge-best' },
  excellent:  { label: '✓ Excellent',   color: '#2dd4bf', badge: 'badge-excellent' },
  good:       { label: '· Bon',         color: '#64748b', badge: 'badge-good' },
  inaccuracy: { label: '?! Imprécision',color: '#eab308', badge: 'badge-inaccuracy' },
  mistake:    { label: '? Erreur',      color: '#f97316', badge: 'badge-mistake' },
  blunder:    { label: '?? Gaffe',      color: '#ef4444', badge: 'badge-blunder' },
  book:       { label: '📖 Théorie',    color: '#64748b', badge: 'badge-book' },
};

// ─── Icons ────────────────────────────────────────────────────
const IconEngine = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
  </svg>
);
const IconCoach = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
  </svg>
);
const IconList = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
  </svg>
);
const IconGraph = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16" />
  </svg>
);
const IconBoard = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
  </svg>
);
const IconUpload = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);
const IconReset = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

// ─── Main Component ────────────────────────────────────────────
export default function Home() {
  const gmRef = useRef<GameManager | null>(null);

  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [heatmap, setHeatmap] = useState<HeatmapData>({});
  const [evaluation, setEvaluation] = useState<EngineEvaluation | null>(null);
  const [analysis, setAnalysis] = useState<MoveAnalysis | null>(null);
  const [moveRecords, setMoveRecords] = useState<MoveRecord[]>([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [opening, setOpening] = useState<{ eco: string; name: string } | null>(null);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null); // C5
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  // E6 — lastMove surligné sur l'échiquier
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);

  // UI toggles
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showThreats, setShowThreats] = useState(true);

  // M14 — Tab mobile : 'board' | 'coach' | 'moves' | 'graph'
  const [mobileTab, setMobileTab] = useState<'board' | 'coach' | 'moves' | 'graph'>('board');
  const [rightTab, setRightTab] = useState<'moves' | 'coach' | 'graph'>('coach');

  // Best move arrow shapes
  const [bestMoveShapes, setBestMoveShapes] = useState<Array<{ orig: string; dest?: string; brush: string }>>([]);

  // Accuracy
  const [accuracy, setAccuracy] = useState<GameAccuracy | null>(null);

  // E5 — État du modal d'import PGN
  const [showPgnModal, setShowPgnModal] = useState(false);
  const [pgnText, setPgnText] = useState('');
  const [pgnError, setPgnError] = useState<string | null>(null);
  const [pgnLoading, setPgnLoading] = useState(false);

  useEffect(() => {
    if (gmRef.current) return;
    const gm = new GameManager();
    gmRef.current = gm;

    gm.eventBus.on('PositionChanged', ({ fen }) => setFen(fen));
    gm.eventBus.on('HeatmapUpdated', (data) => setHeatmap(data));
    gm.eventBus.on('EngineEvaluationUpdated', (data) => {
      setEvaluation(data);
      setIsEngineReady(true);
      setEngineError(null); // Clear any previous error on successful eval

      // Show best move arrow from PV
      if (data.pv && data.pv.length >= 1) {
        const from = data.pv[0].slice(0, 2);
        const to = data.pv[0].slice(2, 4);
        if (from && to) {
          setBestMoveShapes([{ orig: from, dest: to, brush: 'green' }]);
        }
      }
    });
    gm.eventBus.on('PedagogyUpdated', (data) => {
      setAnalysis(data);
      // Persist to localStorage
      try {
        const history = JSON.parse(localStorage.getItem('chess_analysis_history') || '[]');
        history.push(data);
        if (history.length > 200) history.splice(0, 100);
        localStorage.setItem('chess_analysis_history', JSON.stringify(history));
      } catch { /* ignore */ }
    });
    gm.eventBus.on('MoveRecorded', (record) => {
      // E6 — Extraire from/to du dernier coup pour le surlignage
      if (record.uci && record.uci.length >= 4) {
        setLastMove([record.uci.slice(0, 2), record.uci.slice(2, 4)]);
      }
      setMoveRecords(prev => {
        const next = [...prev, record];
        setCurrentMoveIndex(next.length - 1);
        setAccuracy(AccuracyCalculator.computeGameAccuracy(next));
        return next;
      });
    });
    gm.eventBus.on('OpeningDetected', (data) => setOpening(data));
    gm.eventBus.on('NavigateTo', ({ moveIndex, fen: navFen }) => {
      setCurrentMoveIndex(moveIndex);
      setBestMoveShapes([]);
      // E6 — Mettre à jour lastMove lors de la navigation
      if (moveIndex >= 0 && gmRef.current) {
        const records = gmRef.current.getMoveRecords();
        const rec = records[moveIndex];
        if (rec?.uci?.length >= 4) {
          setLastMove([rec.uci.slice(0, 2), rec.uci.slice(2, 4)]);
        } else {
          setLastMove(null);
        }
      } else {
        setLastMove(null);
      }
    });

    // C5 — Afficher une erreur UI si le moteur crash
    gm.eventBus.on('EngineError', (msg) => {
      setEngineError(msg);
      setIsEngineReady(false);
    });

    gm.init();

    return () => {
      gm.terminate();
    };
  }, []);

  const handleMove = useCallback((from: string, to: string) => {
    gmRef.current?.playMove(`${from}${to}`);
    setBestMoveShapes([]);
  }, []);

  const handleNavigate = useCallback((index: number) => {
    // index is 0-based in moveRecords → fenHistory index is index+1
    gmRef.current?.navigateTo(index + 1);
  }, []);

  // C1 — Reset de partie (fonctionne maintenant grâce au fix de resetGame())
  const handleReset = useCallback(() => {
    gmRef.current?.resetGame();
    setMoveRecords([]);
    setAnalysis(null);
    setAccuracy(null);
    setOpening(null);
    setCurrentMoveIndex(-1);
    setLastMove(null);
    setBestMoveShapes([]);
    setEvaluation(null);
  }, []);

  // E5 — Import PGN
  const handlePgnImport = useCallback(async () => {
    if (!pgnText.trim() || !gmRef.current) return;
    setPgnLoading(true);
    setPgnError(null);

    try {
      const result = gmRef.current.loadPgn(pgnText);
      if (!result.success) {
        setPgnError(result.error ?? 'Erreur lors du chargement du PGN');
        setPgnLoading(false);
        return;
      }

      // Reset UI state
      setMoveRecords([]);
      setAnalysis(null);
      setAccuracy(null);
      setOpening(null);
      setCurrentMoveIndex(-1);
      setLastMove(null);
      setBestMoveShapes([]);
      setEvaluation(null);

      setShowPgnModal(false);
      setPgnText('');
      setPgnError(null);
    } catch (err) {
      setPgnError(err instanceof Error ? err.message : 'Erreur inattendue');
    } finally {
      setPgnLoading(false);
    }
  }, [pgnText]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); gmRef.current?.navigatePrev(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); gmRef.current?.navigateNext(); }
    if (e.key === 'f') setOrientation(o => o === 'white' ? 'black' : 'white');
    if (e.key === 'Escape') setShowPgnModal(false);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ─── Board Section ─────────────────────────────────────────
  const boardSection = (
    <section className="flex-1 min-w-0 flex flex-col items-center justify-center p-3 lg:p-6 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-sky-500/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="w-full max-w-[620px] flex flex-col gap-3 relative z-10">
        {/* Current eval score */}
        {evaluation && (
          <div className="flex items-center justify-between px-2">
            <span className="font-mono text-sm font-bold text-slate-200">
              {evaluation.mate !== undefined
                ? `Mat en ${Math.abs(evaluation.mate)}`
                : `${(evaluation.cp ?? 0) > 0 ? '+' : ''}${((evaluation.cp ?? 0) / 100).toFixed(2)}`}
            </span>
            <span className="text-xs text-slate-500">Profondeur {evaluation.depth}</span>
          </div>
        )}

        {/* C5 — Bannière d'erreur moteur */}
        {engineError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span><strong>Erreur Stockfish :</strong> {engineError}</span>
          </div>
        )}

        {/* Board row */}
        <div className="flex gap-3 w-full">
          {/* Eval bar */}
          <div className="w-5 shrink-0" style={{ height: 'min(85vw, 560px)' }}>
            <EvalBar cp={evaluation?.cp} mate={evaluation?.mate} orientation={orientation} />
          </div>

          {/* Board */}
          <div
            className="flex-1 min-w-0 glass-bright rounded-xl overflow-hidden glow-blue"
            style={{ aspectRatio: '1/1', maxHeight: 'min(85vw, 560px)' }}
          >
            <div className="relative w-full h-full">
              <ChessBoard
                fen={fen}
                onMove={handleMove}
                orientation={orientation}
                shapes={bestMoveShapes}
                lastMove={lastMove ?? undefined}  // E6 — Passer lastMove pour le surlignage
              />
              <BoardOverlay>
                {showHeatmap && <HeatmapLayer data={heatmap} orientation={orientation} />}
                {showThreats && analysis && analysis.tacticalMotifs.length > 0 && (
                  <ThreatLayer motifs={analysis.tacticalMotifs} orientation={orientation} />
                )}
              </BoardOverlay>
            </div>
          </div>
        </div>

        {/* Navigation controls */}
        <div className="flex items-center justify-center gap-2">
          <button id="nav-first" onClick={() => gmRef.current?.navigateFirst()} className="btn-icon" title="Début">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button id="nav-prev" onClick={() => gmRef.current?.navigatePrev()} className="btn-icon" title="Précédent (←)">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          </button>
          <button id="nav-next" onClick={() => gmRef.current?.navigateNext()} className="btn-icon" title="Suivant (→)">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
          </button>
          <button id="nav-last" onClick={() => gmRef.current?.navigateLast()} className="btn-icon" title="Fin">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zm2.5-6 5.5 3.92V8.08L8.5 12zM16 6h2v12h-2z"/></svg>
          </button>

          <div className="mx-2 h-4 w-px bg-slate-700" />

          <button
            id="btn-flip"
            onClick={() => setOrientation(o => o === 'white' ? 'black' : 'white')}
            className="btn-icon"
            title="Retourner (f)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>

          {/* C1 — Bouton reset */}
          <button
            id="btn-reset"
            onClick={handleReset}
            className="btn-icon text-red-400 hover:text-red-300"
            title="Nouvelle partie"
          >
            <IconReset />
          </button>

          {/* E5 — Bouton import PGN */}
          <button
            id="btn-pgn"
            onClick={() => setShowPgnModal(true)}
            className="btn-icon text-sky-400 hover:text-sky-300"
            title="Importer un PGN"
          >
            <IconUpload />
          </button>
        </div>
      </div>
    </section>
  );

  // ─── Coach Tab Content ─────────────────────────────────────
  const coachContent = (
    <div className="p-4 flex flex-col gap-4">
      {/* Eval card */}
      <div className="glass rounded-xl p-4 flex flex-col gap-3">
        <p className="section-label">Évaluation</p>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-3xl font-bold text-white">
            {evaluation ? (
              evaluation.mate !== undefined ? (
                <span className="text-sky-400">M{Math.abs(evaluation.mate)}</span>
              ) : (
                <span className={(evaluation.cp ?? 0) >= 0 ? 'text-white' : 'text-slate-300'}>
                  {(evaluation.cp ?? 0) > 0 ? '+' : ''}
                  {((evaluation.cp ?? 0) / 100).toFixed(2)}
                </span>
              )
            ) : (
              <span className="text-slate-600 animate-pulse">0.00</span>
            )}
          </span>
          <span className="text-xs text-slate-500">prof. {evaluation?.depth ?? 0}</span>
        </div>

        {/* Win probability bar */}
        {evaluation && (
          <WinProbBar cp={evaluation.cp ?? 0} mate={evaluation.mate} />
        )}
      </div>

      {/* PV Line */}
      {evaluation && evaluation.pv.length > 0 && (
        <div>
          <p className="section-label mb-2">Meilleure ligne</p>
          <div className="flex flex-wrap gap-1.5">
            {evaluation.pv.slice(0, 8).map((move, i) => (
              <span key={i} className="px-2 py-0.5 rounded bg-slate-800 text-sky-300 border border-slate-700/50 text-xs font-mono">
                {move}
              </span>
            ))}
            {evaluation.pv.length > 8 && <span className="text-slate-500 text-xs self-center">…</span>}
          </div>
        </div>
      )}

      {/* Coach IA card */}
      {analysis ? (
        <div className="glass rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden">
          {/* Accent bar */}
          <div
            className="absolute left-0 top-0 w-1 h-full rounded-l-xl"
            style={{ background: CLASS_CONFIG[analysis.classification]?.color ?? '#64748b' }}
          />

          <div className="pl-3">
            <p className="section-label mb-2">Coach IA</p>
            <div className="flex items-center gap-2 mb-3">
              <span className={`badge ${CLASS_CONFIG[analysis.classification]?.badge ?? 'badge-good'}`}>
                {CLASS_CONFIG[analysis.classification]?.label ?? analysis.classification}
              </span>
              {analysis.accuracy !== undefined && (
                <span className="text-xs text-slate-400">
                  Précision {analysis.accuracy.toFixed(0)}%
                </span>
              )}
            </div>

            <p className="text-sm text-slate-200 leading-relaxed">
              {analysis.explanation}
            </p>

            {/* Best move suggestion */}
            {analysis.bestMove && analysis.classification !== 'best' && analysis.classification !== 'brilliant' && (
              <div className="mt-3 pt-3 border-t border-slate-700/50">
                <p className="text-xs text-slate-500 mb-1">Meilleur coup suggéré :</p>
                <span className="font-mono text-sky-300 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded text-sm">
                  {analysis.bestMove}
                </span>
              </div>
            )}

            {/* Tactical motifs */}
            {analysis.tacticalMotifs.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {analysis.tacticalMotifs.map((m, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                    {m.type === 'hanging_piece' && '⚠ Pièce en prise'}
                    {m.type === 'fork' && '⚔ Fourchette'}
                    {m.type === 'pin' && '📌 Clouage'}
                    {m.type === 'skewer' && '→ Enfilade'}
                    {m.type === 'discovered_attack' && '💥 Attaque découverte'}
                  </span>
                ))}
              </div>
            )}

            {/* Opening */}
            {analysis.opening && (
              <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5">
                <span className="text-sky-400 font-mono">📖</span>
                {analysis.opening}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="glass rounded-xl p-6 flex flex-col items-center justify-center gap-2 text-center">
          <IconCoach />
          <p className="text-sm text-slate-400">
            Jouez un coup pour recevoir l'analyse du Coach IA
          </p>
        </div>
      )}
    </div>
  );

  // ─── Moves Tab Content ─────────────────────────────────────
  const movesContent = (
    <div className="p-3">
      <MoveList
        moves={moveRecords}
        currentMoveIndex={currentMoveIndex}
        onMoveClick={handleNavigate}
      />
    </div>
  );

  // ─── Graph Tab Content ─────────────────────────────────────
  const graphContent = (
    <div className="p-4 flex flex-col gap-4">
      <p className="section-label">Graphe d'évaluation</p>
      <EvalGraph
        moves={moveRecords}
        currentMoveIndex={currentMoveIndex}
        onMoveClick={handleNavigate}
      />

      {accuracy && moveRecords.length > 0 && (
        <div className="glass rounded-xl p-4 flex flex-col gap-3">
          <p className="section-label">Précision de la partie</p>
          <div className="flex gap-4">
            <AccuracyBlock label="Blancs" value={accuracy.white} />
            <AccuracyBlock label="Noirs" value={accuracy.black} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <PhaseBlock label="Ouverture" value={accuracy.opening} />
            <PhaseBlock label="Milieu" value={accuracy.middlegame} />
            <PhaseBlock label="Finale" value={accuracy.endgame} />
          </div>
        </div>
      )}
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div
      className="h-full flex flex-col"
      style={{ background: 'var(--background)', color: 'var(--foreground)', fontFamily: 'var(--font-geist-sans, system-ui)' }}
    >
      {/* ── Navbar ── */}
      <header className="glass shrink-0 px-4 py-3 flex items-center justify-between z-20 border-b border-[rgba(56,189,248,0.1)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight">
            Chess<span className="text-gradient">Analyzer</span>
          </span>
          {opening && (
            <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-500/10 border border-sky-500/25 text-sky-300 ml-2">
              <span className="text-sky-400 font-mono">{opening.eco}</span>
              {opening.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Engine status */}
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${engineError ? 'bg-red-500' : isEngineReady ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.7)]' : 'bg-yellow-500 animate-pulse'}`} />
            <span className="text-xs text-slate-400 hidden sm:block">
              {engineError ? 'Erreur moteur' : isEngineReady ? 'Stockfish 16.1' : 'Initialisation…'}
            </span>
          </div>

          {/* Accuracy display */}
          {accuracy && (
            <div className="hidden md:flex items-center gap-3 text-xs border-l border-slate-700 pl-3">
              <AccuracyBadge label="Blancs" value={accuracy.white} />
              <AccuracyBadge label="Noirs" value={accuracy.black} />
            </div>
          )}

          {/* E5 — Bouton import PGN dans la navbar */}
          <button
            id="navbar-pgn"
            onClick={() => setShowPgnModal(true)}
            className="btn-icon text-sky-400 hover:text-sky-300"
            title="Importer PGN"
          >
            <IconUpload />
          </button>

          <button
            id="navbar-flip"
            onClick={() => setOrientation(o => o === 'white' ? 'black' : 'white')}
            className="btn-icon"
            title="Retourner l'échiquier (f)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Main layout : desktop 3 colonnes, mobile onglets ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Left Sidebar (desktop uniquement) ── */}
        <aside className="hidden lg:flex shrink-0 w-56 flex-col glass border-r border-[rgba(56,189,248,0.08)] overflow-y-auto">
          <div className="p-4 flex flex-col gap-6">

            {/* Overlays toggles */}
            <div>
              <p className="section-label mb-3">Visualisation</p>
              <div className="flex flex-col gap-2">
                <Toggle
                  label="Heatmap de pression"
                  value={showHeatmap}
                  onChange={setShowHeatmap}
                  color="sky"
                />
                <Toggle
                  label="Alertes tactiques"
                  value={showThreats}
                  onChange={setShowThreats}
                  color="red"
                />
              </div>
            </div>

            {/* Engine status */}
            <div>
              <p className="section-label mb-3">Moteur</p>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${engineError ? 'bg-red-500' : isEngineReady ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]' : 'bg-yellow-500 animate-pulse'}`} />
                <span className="text-xs text-slate-300">
                  {engineError ? 'Erreur' : isEngineReady ? 'Stockfish 16.1 prêt' : 'Démarrage…'}
                </span>
              </div>
              {engineError && (
                <p className="mt-1 text-[10px] text-red-400 leading-relaxed">{engineError}</p>
              )}
              {evaluation && !engineError && (
                <div className="mt-2 text-xs text-slate-500">
                  Profondeur {evaluation.depth} · {evaluation.pv.length} coups
                </div>
              )}
            </div>

            {/* Accuracy per phase */}
            {accuracy && (
              <div>
                <p className="section-label mb-3">Accuracy par phase</p>
                <div className="flex flex-col gap-1.5">
                  <PhaseBar label="Ouverture" value={accuracy.opening} />
                  <PhaseBar label="Milieu" value={accuracy.middlegame} />
                  <PhaseBar label="Finale" value={accuracy.endgame} />
                </div>
              </div>
            )}

            {/* Keyboard shortcuts */}
            <div>
              <p className="section-label mb-2">Raccourcis</p>
              <div className="flex flex-col gap-1 text-[10px] text-slate-500">
                <span>← → Navigation</span>
                <span>F  Retourner</span>
                <span>Esc Fermer modal</span>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Desktop: center board ── */}
        <div className="hidden lg:flex flex-1 min-w-0">
          {boardSection}
        </div>

        {/* ── Mobile: onglet board ── */}
        <div className={`lg:hidden flex-1 min-w-0 flex flex-col ${mobileTab === 'board' ? 'flex' : 'hidden'}`}>
          {boardSection}
        </div>

        {/* ── Right Sidebar (desktop) ── */}
        <aside className="hidden lg:flex shrink-0 w-80 flex-col glass border-l border-[rgba(56,189,248,0.08)]">
          {/* Tab bar */}
          <div className="flex border-b border-[rgba(56,189,248,0.08)] shrink-0">
            {(
              [
                { key: 'coach', icon: <IconCoach />, label: 'Coach' },
                { key: 'moves', icon: <IconList />, label: 'Coups' },
                { key: 'graph', icon: <IconGraph />, label: 'Graphe' },
              ] as const
            ).map(tab => (
              <button
                key={tab.key}
                id={`tab-${tab.key}`}
                onClick={() => setRightTab(tab.key)}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold uppercase tracking-wider transition-all ${
                  rightTab === tab.key
                    ? 'text-sky-300 border-b-2 border-sky-400'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {rightTab === 'coach' && coachContent}
            {rightTab === 'moves' && movesContent}
            {rightTab === 'graph' && graphContent}
          </div>
        </aside>

        {/* ── Mobile: onglets coach/coups/graph ── */}
        <div className={`lg:hidden flex-1 min-w-0 flex flex-col overflow-y-auto glass ${mobileTab !== 'board' ? 'flex' : 'hidden'}`}>
          {mobileTab === 'coach' && coachContent}
          {mobileTab === 'moves' && movesContent}
          {mobileTab === 'graph' && graphContent}
        </div>
      </div>

      {/* ── M14 — Barre d'onglets mobile en bas ── */}
      <nav className="lg:hidden shrink-0 glass border-t border-[rgba(56,189,248,0.1)] flex">
        {(
          [
            { key: 'board', icon: <IconBoard />, label: 'Échiquier' },
            { key: 'coach', icon: <IconCoach />, label: 'Coach' },
            { key: 'moves', icon: <IconList />, label: 'Coups' },
            { key: 'graph', icon: <IconGraph />, label: 'Graphe' },
          ] as const
        ).map(tab => (
          <button
            key={tab.key}
            id={`mobile-tab-${tab.key}`}
            onClick={() => setMobileTab(tab.key)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[9px] font-semibold uppercase tracking-wider transition-all ${
              mobileTab === tab.key
                ? 'text-sky-300 border-t-2 border-sky-400 -mt-px'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── E5 — Modal Import PGN ── */}
      {showPgnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="glass rounded-2xl w-full max-w-lg flex flex-col gap-4 p-6 border border-[rgba(56,189,248,0.15)] shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <IconUpload />
                Importer un PGN
              </h2>
              <button
                id="pgn-modal-close"
                onClick={() => { setShowPgnModal(false); setPgnError(null); }}
                className="btn-icon"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Collez votre PGN ci-dessous. La partie sera chargée et vous pourrez naviguer coup par coup.
            </p>

            <textarea
              id="pgn-textarea"
              className="w-full h-48 bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-200 resize-none focus:outline-none focus:border-sky-500/50 transition-colors"
              placeholder={`[Event "Partie exemple"]\n[White "Joueur 1"]\n[Black "Joueur 2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 *`}
              value={pgnText}
              onChange={e => { setPgnText(e.target.value); setPgnError(null); }}
            />

            {pgnError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {pgnError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                id="pgn-cancel"
                onClick={() => { setShowPgnModal(false); setPgnError(null); }}
                className="flex-1 py-2.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-medium transition-colors"
              >
                Annuler
              </button>
              <button
                id="pgn-submit"
                onClick={handlePgnImport}
                disabled={pgnLoading || !pgnText.trim()}
                className="flex-1 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                {pgnLoading ? 'Chargement…' : 'Charger la partie'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function Toggle({
  label, value, onChange, color = 'sky'
}: { label: string; value: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group">
      <div className="relative shrink-0">
        <input type="checkbox" className="sr-only" checked={value} onChange={e => onChange(e.target.checked)} />
        <div className={`w-8 h-4 rounded-full transition-colors ${value ? (color === 'red' ? 'bg-red-500' : 'bg-sky-500') : 'bg-slate-700'}`} />
        <div className={`absolute top-0.5 left-0.5 bg-white w-3 h-3 rounded-full transition-transform shadow ${value ? 'translate-x-4' : ''}`} />
      </div>
      <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">{label}</span>
    </label>
  );
}

function AccuracyBadge({ label, value }: { label: string; value: number }) {
  const color = value >= 85 ? 'text-green-400' : value >= 70 ? 'text-yellow-400' : 'text-red-400';
  return (
    <div className="flex items-center gap-1">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono font-bold ${color}`}>{value.toFixed(0)}%</span>
    </div>
  );
}

function AccuracyBlock({ label, value }: { label: string; value: number }) {
  const color = value >= 85 ? '#34d399' : value >= 70 ? '#fbbf24' : '#f87171';
  return (
    <div className="flex-1 flex flex-col items-center gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="font-mono text-2xl font-bold" style={{ color }}>{value.toFixed(0)}</span>
      <span className="text-[10px] text-slate-500">%</span>
    </div>
  );
}

function PhaseBar({ label, value }: { label: string; value: number }) {
  const color = value >= 85 ? '#34d399' : value >= 70 ? '#fbbf24' : '#f87171';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-500 w-14 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono text-slate-400 w-8 text-right">{value.toFixed(0)}%</span>
    </div>
  );
}

function PhaseBlock({ label, value }: { label: string; value: number }) {
  const color = value >= 85 ? '#34d399' : value >= 70 ? '#fbbf24' : '#f87171';
  return (
    <div className="flex flex-col items-center gap-0.5 p-2 rounded-lg bg-slate-800/50">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className="font-mono text-sm font-bold" style={{ color }}>{value.toFixed(0)}%</span>
    </div>
  );
}

// L13 — WinProbBar centralisé (une seule copie de la formule)
function WinProbBar({ cp, mate }: { cp: number; mate?: number }) {
  const winProb = mate !== undefined
    ? (mate > 0 ? 0.99 : 0.01)
    : 1 / (1 + Math.exp(-0.00368208 * Math.max(-10000, Math.min(10000, cp))));
  const whitePercent = (winProb * 100).toFixed(0);
  const blackPercent = (100 - winProb * 100).toFixed(0);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-white/70">Blancs {whitePercent}%</span>
        <span className="text-slate-400">Noirs {blackPercent}%</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden bg-slate-800 flex">
        <div
          className="h-full rounded-l-full transition-all duration-500"
          style={{ width: `${whitePercent}%`, background: 'linear-gradient(to right, #cbd5e1, #f8fafc)' }}
        />
        <div
          className="h-full rounded-r-full transition-all duration-500"
          style={{ width: `${blackPercent}%`, background: 'linear-gradient(to left, #1e293b, #334155)' }}
        />
      </div>
    </div>
  );
}
