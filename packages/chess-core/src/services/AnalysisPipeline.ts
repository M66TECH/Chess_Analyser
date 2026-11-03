import { GameEventBus, EngineEvaluation } from '../events/GameEventBus';
import { MoveManager } from './MoveManager';
import { EngineManager } from '../engine/EngineManager';
import { EvalNormalizer } from '../analysis/EvalNormalizer';
import { AccuracyScore } from '../analysis/AccuracyScore';
import { MoveClassifier } from '../pedagogy/MoveClassifier';
import { EvalCache } from '../cache/EvalCache';
import { OpeningExplorer } from '../explorer/OpeningExplorer';
import { OpeningBook } from '../explorer/OpeningBook';
import type { OpeningData } from '../explorer/ExplorerCache';
import { MoveRecord, MoveNode, MoveTheory } from '../pedagogy/types';
import { ExplanationEngine } from '../pedagogy/ExplanationEngine';

interface PendingMove {
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
  color: 'white' | 'black';
  nodeId: string;
  moveNumber: number;
}

export class AnalysisPipeline {
  private evalCache = new EvalCache();
  private moveRecords: MoveRecord[] = [];

  // State for the currently analyzing move
  private pendingMove: PendingMove | null = null;
  private evalBeforeMove: EngineEvaluation | null = null;
  private latestEval: EngineEvaluation | null = null;
  /** Theory data for the pending move; null while the lookup is in flight. */
  private pendingTheory: MoveTheory | undefined = undefined;
  private theoryResolved = false;
  private pedagogyDone = false;
  private warmFen: string | null = null;
  private readonly targetDepth = 14;

  constructor(
    private eventBus: GameEventBus,
    private moveManager: MoveManager,
    private engineManager: EngineManager
  ) {
    this.setupListeners();
  }

  private setupListeners() {
    this.eventBus.on('MovePlayed', async ({ fenBefore, fenAfter, move, nodeId }) => {
      // Get the node to extract SAN
      const tree = this.moveManager.getTree();
      const node = tree.nodes.get(nodeId);
      const san = node ? node.san : move;
      const color = node ? node.color : 'white';
      const nodeUci = node ? node.uci : move;

      // Retrieve eval BEFORE the move was played. A missing cached evaluation is
      // kept as null: substituting {cp: 0} would fabricate an "equal" starting
      // point and corrupt the accuracy of the very first move (E1).
      const evalBefore = await this.evalCache.get(fenBefore);
      this.evalBeforeMove = evalBefore ?? null;
      this.latestEval = null;
      this.pedagogyDone = false;

      this.pendingMove = {
        uci: nodeUci,
        san,
        fenBefore,
        fenAfter,
        color,
        nodeId,
        moveNumber: this.moveManager.getCurrentMoveNumber(),
      };
      this.warmFen = null;

      // Emit new position
      this.eventBus.emit('PositionChanged', { fen: fenAfter });

      // Ask the opening database about the position *before* the move: that is
      // where the played move has to be measured against human theory.
      this.pendingTheory = undefined;
      this.theoryResolved = false;
      const theoryPromise = OpeningExplorer.fetchWithOpening(fenBefore)
        .catch(() => ({ data: null as OpeningData | null, opening: null as { eco: string; name: string } | null }))
        .then(({ data, opening }) => {
          if (opening) {
            this.eventBus.emit('OpeningDetected', { eco: opening.eco, name: opening.name });
          }
          const pending = this.pendingMove;
          // Ignore a late answer for a move the user already left.
          if (pending && pending.fenAfter === fenAfter) {
            this.pendingTheory = this.buildTheory(nodeUci, fenBefore, data, opening);
            this.theoryResolved = true;
            this.maybeRunPedagogy();
          }
        });

      // Launch the engine right away; the theory answer joins when it arrives.
      void theoryPromise;
      this.engineManager.analyze(fenAfter, this.targetDepth);
    });

    // Race navigation/analyse : invalider toute analyse en cours
    this.eventBus.on('NavigateTo', () => {
      this.pendingMove = null;
      this.warmFen = null;
      this.latestEval = null;
      this.pendingTheory = undefined;
      this.theoryResolved = true;
      this.pedagogyDone = false;
    });

    this.eventBus.on('EngineEvaluationUpdated', (evaluation) => {
      // Only the primary PV line is used for caching and pedagogy
      if (evaluation.multiPv && evaluation.multiPv !== 1) return;

      // A previously scheduled (stale) warm-up must never be written while a
      // real move is pending, otherwise it would pollute the eval cache.
      if (!this.pendingMove) {
        // Warm-up: cache the initial position eval so the first move's bestMove is available
        if (this.warmFen && evaluation.depth >= this.targetDepth && evaluation.fen === this.warmFen) {
          this.warmFen = null;
          this.evalCache.set(evaluation.fen!, evaluation);
        }
        return;
      }

      // Discard evaluations that belong to another position (navigation, rapid play)
      if (evaluation.fen && evaluation.fen !== this.pendingMove.fenAfter) return;

      // Undefined/FEN-less evaluations cannot be attributed to the pending move.
      if (!evaluation.fen) return;

      this.latestEval = evaluation;

      // Run pedagogy when reaching target depth (or when the search is over: mate found, stop, etc.)
      if (!this.pedagogyDone && evaluation.depth >= this.targetDepth) {
        this.pedagogyDone = true;
        this.evalCache.set(this.pendingMove.fenAfter, evaluation);
        this.maybeRunPedagogy();
      }
    });

    // E3 — The engine emits "bestmove" when a search ends before reaching the target
    // depth (mate found, engine stopped, ...). Use the latest evaluation received for
    // the pending position instead of waiting forever.
    this.eventBus.on('AnalysisFinished', () => {
      if (!this.pendingMove || this.pedagogyDone) return;
      const latest = this.latestEval;
      if (!latest || latest.fen !== this.pendingMove.fenAfter) return;
      this.pedagogyDone = true;
      this.evalCache.set(this.pendingMove.fenAfter, latest);
      this.maybeRunPedagogy();
    });
  }

  /**
   * Runs the pedagogy as soon as both the engine evaluation and the opening
   * database answer are available. Whichever finishes last triggers it, so the
   * coach never waits for a network call that already failed.
   */
  private maybeRunPedagogy() {
    const latest = this.latestEval;
    if (!this.pedagogyDone || !latest) return;
    if (this.pendingMove && latest.fen !== this.pendingMove.fenAfter) return;

    // Wait for the theory lookup only while it is genuinely in flight.
    if (!this.theoryResolved) return;

    this.runPedagogy(latest);
  }

  private buildTheory(
    uci: string,
    fenBefore: string,
    data: OpeningData | null,
    opening: { eco: string; name: string } | null
  ): MoveTheory | undefined {
    if (!data) return undefined;

    const ranked = OpeningBook.rank(fenBefore, data, fenBefore.split(' ')[1] === 'b' ? 'black' : 'white');
    if (ranked.length === 0) return undefined;

    const played = ranked.find(m => m.uci === uci);
    const best = ranked[0];

    // Consider a move theory when it is the main human choice or close enough
    // in popularity to the main line (e.g. equally played transpositions).
    const isTheory = !!played && played.frequency >= best.frequency * 0.5;

    return {
      inBook: true,
      eco: opening?.eco,
      openingName: opening?.name,
      frequency: played?.frequency,
      games: played?.games,
      isTheory,
    };
  }

  private runPedagogy(evalAfter: EngineEvaluation) {
    if (!this.pendingMove) return;

    const { uci, san, fenBefore, fenAfter, color, nodeId, moveNumber } = this.pendingMove;

    // Without a trustworthy pre-move evaluation the move cannot be judged:
    // fall back to a neutral record instead of inventing an accuracy (E1).
    const evalBefore = this.evalBeforeMove;
    const sideToMoveAfter: 'white' | 'black' = color === 'white' ? 'black' : 'white';

    // 1. Normalize scores (White's POV), accounting for the side to move (mate sign)
    const normCpBefore = evalBefore
      ? EvalNormalizer.normalize(evalBefore.cp, evalBefore.mate, color)
      : EvalNormalizer.normalize(evalAfter.cp, evalAfter.mate, sideToMoveAfter);
    const normCpAfter = EvalNormalizer.normalize(evalAfter.cp, evalAfter.mate, sideToMoveAfter);

    // 2. Winning chances dropped by the player (positive = lost chances)
    const winDrop = evalBefore
      ? EvalNormalizer.winningChancesDiff(normCpBefore, normCpAfter, color)
      : 0;

    // Best move from BEFORE the move
    const bestMove = evalBefore && evalBefore.pv.length > 0 ? evalBefore.pv[0] : undefined;
    const isBestMove = !!bestMove && bestMove === uci;

    // Human theory: the Lichess database may consider this move normal even
    // though Stockfish's preferred line differs.
    const theory = this.pendingTheory;

    // Scores en POV du joueur pour le jugement Lichess (`Advice.scala`) :
    // `evalBefore` est déjà POV joueur (c'était son trait), `evalAfter` est
    // POV adversaire → signes inversés. Les champs cp/mate restent discrets :
    // lila exécute CpAdvice (deux cp) OU MateAdvice (mat impliqué), jamais un
    // mélange avec le mat replié en centipions.
    const prevScore = evalBefore
      ? { cp: evalBefore.cp, mate: evalBefore.mate }
      : undefined;
    const nextScore = {
      cp: evalAfter.cp === undefined ? undefined : -evalAfter.cp,
      mate: evalAfter.mate === undefined ? undefined : -evalAfter.mate,
    };

    // 3. Classification (jugement Lichess d'abord, barème interne ensuite)
    const { classification, accuracy, mateSequence } = MoveClassifier.classify(winDrop, {
      isBestMove,
      isTheory: theory?.isTheory ?? false,
      prevScore,
      nextScore,
    });

    // Awareness & Luck
    let awareness: boolean | undefined = undefined;
    const prevRecord = this.moveRecords.length > 0 ? this.moveRecords[this.moveRecords.length - 1] : null;
    
    if (prevRecord) {
      // Si l'adversaire a fait une erreur au coup précédent
      const prevWasMistake = prevRecord.classification === 'mistake' || prevRecord.classification === 'blunder';
      if (prevWasMistake) {
        const weMistake = classification === 'mistake' || classification === 'blunder';
        awareness = !weMistake;
      }
      
      // Si on a fait une erreur au coup précédent, le coup actuel de l'adversaire détermine notre chance
      const weMistakePrev = prevRecord.classification === 'mistake' || prevRecord.classification === 'blunder';
      if (weMistakePrev) {
        const opponentMistake = classification === 'mistake' || classification === 'blunder';
        prevRecord.luck = opponentMistake;
      }
    }

    const analysis: MoveRecord = {
      fenBefore,
      fenAfter,
      playedMove: uci,
      bestMove,
      cpBefore: normCpBefore,
      mateBefore: evalBefore?.mate,
      cpAfter: normCpAfter,
      mateAfter: evalAfter.mate,
      winProbBefore: EvalNormalizer.cpToWinningChances(normCpBefore),
      winProbAfter: EvalNormalizer.cpToWinningChances(normCpAfter),
      accuracy,
      classification,
      awareness,
      opening: theory?.openingName,
      theory,
      mateSequence,
      moveNumber,
      color,
      san,
      nodeId,
    };

    this.moveRecords.push(analysis);
    this.eventBus.emit('PedagogyUpdated', analysis);
    this.eventBus.emit('MoveRecorded', analysis);
    this.eventBus.emit('AccuracyUpdated', AccuracyScore.computeGameStats(this.moveRecords));

    // L'IA ne remplace pas l'analyse Lichess : elle la traduit en fiche
    // pédagogique (coup joué, coup manqué, erreur, bonne décision, conséquence).
    const previous = this.moveRecords.at(-2);
    ExplanationEngine.generateCard(analysis, 'intermediaire', previous?.classification ?? null)
      .then(card => {
        analysis.coachCard = card;
        // The user may have navigated away in the meantime: only refresh the
        // bubble if this record is still the one being displayed.
        if (this.pendingMove?.nodeId === nodeId || this.moveRecords.at(-1)?.nodeId === nodeId) {
          this.eventBus.emit('PedagogyUpdated', analysis);
        }
      })
      .catch(error => {
        console.error('[AnalysisPipeline] Coach card failed:', error);
      });
  }

  /**
   * Replays a PGN (nodes in mainline order) through the full analysis pipeline:
   * engine evaluation of every position + pedagogy. Sequential, awaiting the
   * target depth for each position before moving to the next.
   */
  public async analyzeGame(nodes: MoveNode[]): Promise<void> {
    this.pendingMove = null;
    this.pedagogyDone = false;
    this.warmFen = null;
    this.latestEval = null;
    this.pendingTheory = undefined;
    this.theoryResolved = false;
    if (nodes.length === 0) return;

    for (const node of nodes) {
      // The pre-move evaluation is either the one cached for fenBefore or, for the
      // very first move, the one we compute right now. Never fabricate {cp: 0}.
      const evalBefore =
        (await this.evalCache.get(node.fenBefore)) ?? (await this.awaitEval(node.fenBefore));
      if (!evalBefore) continue;
      this.evalCache.set(node.fenBefore, evalBefore);

      const evalAfter = await this.awaitEval(node.fenAfter);
      if (!evalAfter) continue;

      // Opening database lookup for this position (human theory).
      const { data, opening } = await OpeningExplorer.fetchWithOpening(node.fenBefore);
      if (opening) {
        this.eventBus.emit('OpeningDetected', { eco: opening.eco, name: opening.name });
      }

      this.evalBeforeMove = evalBefore;
      this.latestEval = evalAfter;
      this.pendingMove = {
        uci: node.uci,
        san: node.san,
        fenBefore: node.fenBefore,
        fenAfter: node.fenAfter,
        color: node.color,
        nodeId: node.id,
        moveNumber: node.moveNumber,
      };
      this.pendingTheory = this.buildTheory(node.uci, node.fenBefore, data, opening);
      this.theoryResolved = true;
      // Prevent the event-driven handler from re-running this position
      this.pedagogyDone = true;
      this.runPedagogy(evalAfter);
    }

    this.pendingMove = null;
    this.evalBeforeMove = null;
    this.pedagogyDone = false;
    this.latestEval = null;
    this.pendingTheory = undefined;
    this.theoryResolved = false;
  }

  /**
   * Waits for the primary-PV evaluation of `fen` to reach `depth`.
   */
  private awaitEval(fen: string, depth: number = this.targetDepth, timeoutMs: number = 30000): Promise<EngineEvaluation | null> {
    return new Promise((resolve) => {
      let resolved = false;
      // Keep the deepest evaluation seen, so a search that ends before `depth`
      // (mate found, stop) still yields a usable score instead of null.
      let best: EngineEvaluation | null = null;
      const finish = (value: EngineEvaluation | null) => {
        if (resolved) return;
        resolved = true;
        this.eventBus.off('EngineEvaluationUpdated', handler);
        this.eventBus.off('AnalysisFinished', onFinished);
        clearTimeout(timer);
        resolve(value);
      };
      const handler = (evaluation: EngineEvaluation) => {
        if (resolved) return;
        if (evaluation.multiPv && evaluation.multiPv !== 1) return;
        if (evaluation.fen && evaluation.fen !== fen) return;
        if (!best || evaluation.depth > best.depth) best = evaluation;
        if (evaluation.depth >= depth) finish(evaluation);
      };
      const onFinished = () => finish(best);
      const timer = setTimeout(() => finish(best), timeoutMs);
      this.eventBus.on('EngineEvaluationUpdated', handler);
      this.eventBus.on('AnalysisFinished', onFinished);
      this.engineManager.analyze(fen, depth);
    });
  }

  public initialize(fen?: string) {
    const currentFen = fen || this.moveManager.getFen();
    this.eventBus.emit('PositionChanged', { fen: currentFen });
    this.warmFen = currentFen;
    this.engineManager.analyze(currentFen, this.targetDepth);
  }

  public getMoveRecords(): MoveRecord[] {
    return [...this.moveRecords];
  }

  /**
   * Drops the in-flight analysis without clearing the recorded moves.
   * Used when the board position changes by a path the pipeline did not see
   * (new move from an earlier node), so stale evaluations cannot be attributed
   * to the wrong move.
   */
  public resetPending() {
    this.pendingMove = null;
    this.evalBeforeMove = null;
    this.latestEval = null;
    this.pendingTheory = undefined;
    this.theoryResolved = false;
    this.pedagogyDone = false;
    this.warmFen = null;
  }

  public reset() {
    this.moveRecords = [];
    this.resetPending();
  }
}
