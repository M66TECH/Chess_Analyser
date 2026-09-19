import { GameEventBus, EngineEvaluation } from '../events/GameEventBus';
import { MoveManager } from './MoveManager';
import { EngineManager } from '../engine/EngineManager';
import { EvalNormalizer } from '../analysis/EvalNormalizer';
import { MoveClassifier } from '../pedagogy/MoveClassifier';
import { EvalCache } from '../cache/EvalCache';
import { OpeningExplorer } from '../explorer/OpeningExplorer';
import { MoveRecord, MoveNode } from '../pedagogy/types';
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

      // Retrieve eval BEFORE the move was played
      const evalBefore = await this.evalCache.get(fenBefore);
      this.evalBeforeMove = evalBefore ?? { depth: 0, cp: 0, pv: [] };
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

      // Fetch opening asynchronously
      OpeningExplorer.fetch(fenAfter).then(data => {
        if (data && data.opening) {
          this.eventBus.emit('OpeningDetected', { eco: data.opening.eco, name: data.opening.name });
        }
      });

      // Launch engine
      this.engineManager.analyze(fenAfter, this.targetDepth);
    });

    // Race navigation/analyse : invalider toute analyse en cours
    this.eventBus.on('NavigateTo', () => {
      this.pendingMove = null;
      this.warmFen = null;
      this.pedagogyDone = false;
    });

    this.eventBus.on('EngineEvaluationUpdated', (evaluation) => {
      // Only the primary PV line is used for caching and pedagogy
      if (evaluation.multiPv && evaluation.multiPv !== 1) return;

      if (!this.pendingMove) {
        // Warm-up: cache the initial position eval so the first move's bestMove is available
        if (this.warmFen && evaluation.depth >= this.targetDepth && evaluation.fen === this.warmFen) {
          this.evalCache.set(this.warmFen, evaluation);
          this.warmFen = null;
        }
        return;
      }

      // Discard evaluations that belong to another position (navigation, rapid play)
      if (evaluation.fen && evaluation.fen !== this.pendingMove.fenAfter) return;

      this.evalCache.set(this.pendingMove.fenAfter, evaluation);

      // Run pedagogy when reaching target depth
      if (!this.pedagogyDone && evaluation.depth >= this.targetDepth) {
        this.pedagogyDone = true;
        this.runPedagogy(evaluation);
      }
    });
  }

  private runPedagogy(evalAfter: EngineEvaluation) {
    if (!this.pendingMove || !this.evalBeforeMove) return;

    const { uci, san, fenBefore, fenAfter, color, nodeId, moveNumber } = this.pendingMove;
    const sideToMoveAfter: 'white' | 'black' = color === 'white' ? 'black' : 'white';

    // 1. Normalize scores (White's POV), accounting for the side to move (mate sign)
    const normCpBefore = EvalNormalizer.normalize(this.evalBeforeMove.cp, this.evalBeforeMove.mate, color);
    const normCpAfter = EvalNormalizer.normalize(evalAfter.cp, evalAfter.mate, sideToMoveAfter);

    // 2. Winning chances dropped by the player (positive = lost chances)
    const winDrop = EvalNormalizer.winningChancesDiff(normCpBefore, normCpAfter, color);

    // Best move from BEFORE the move
    const bestMove = this.evalBeforeMove.pv.length > 0 ? this.evalBeforeMove.pv[0] : undefined;
    const isBestMove = !!bestMove && bestMove === uci;

    // 3. Classification
    const { classification, accuracy } = MoveClassifier.classify(winDrop, isBestMove);

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
      mateBefore: this.evalBeforeMove.mate,
      cpAfter: normCpAfter,
      mateAfter: evalAfter.mate,
      winProbBefore: EvalNormalizer.cpToWinningChances(normCpBefore),
      winProbAfter: EvalNormalizer.cpToWinningChances(normCpAfter),
      accuracy,
      classification,
      awareness,
      moveNumber,
      color,
      san,
      nodeId,
    };

    this.moveRecords.push(analysis);
    this.eventBus.emit('PedagogyUpdated', analysis);
    this.eventBus.emit('MoveRecorded', analysis);

    // Appel asynchrone à Groq pour générer l'explication sans bloquer l'UI
    ExplanationEngine.generateExplanation(analysis).then(explanation => {
      analysis.explanation = explanation;
      this.eventBus.emit('PedagogyUpdated', analysis); // Re-trigger update
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
    if (nodes.length === 0) return;

    // Warm the initial position cache so the first move has a real evalBefore/bestMove
    const startFen = nodes[0].fenBefore;
    const startEval = await this.awaitEval(startFen);
    if (startEval) this.evalCache.set(startFen, startEval);

    for (const node of nodes) {
      const evalBefore = (await this.evalCache.get(node.fenBefore)) ?? { depth: 0, cp: 0, pv: [] };
      const evalAfter = await this.awaitEval(node.fenAfter);
      if (!evalAfter) continue;

      this.evalBeforeMove = evalBefore;
      this.pendingMove = {
        uci: node.uci,
        san: node.san,
        fenBefore: node.fenBefore,
        fenAfter: node.fenAfter,
        color: node.color,
        nodeId: node.id,
        moveNumber: node.moveNumber,
      };
      // Prevent the event-driven handler from re-running this position
      this.pedagogyDone = true;
      this.runPedagogy(evalAfter);
    }

    this.pendingMove = null;
    this.pedagogyDone = false;
  }

  /**
   * Waits for the primary-PV evaluation of `fen` to reach `depth`.
   */
  private awaitEval(fen: string, depth: number = this.targetDepth, timeoutMs: number = 30000): Promise<EngineEvaluation | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const handler = (evaluation: EngineEvaluation) => {
        if (resolved) return;
        if (evaluation.multiPv && evaluation.multiPv !== 1) return;
        if (evaluation.depth < depth) return;
        if (evaluation.fen && evaluation.fen !== fen) return;
        resolved = true;
        this.eventBus.off('EngineEvaluationUpdated', handler);
        clearTimeout(timer);
        resolve(evaluation);
      };
      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.eventBus.off('EngineEvaluationUpdated', handler);
        resolve(null);
      }, timeoutMs);
      this.eventBus.on('EngineEvaluationUpdated', handler);
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

  public reset() {
    this.moveRecords = [];
    this.pendingMove = null;
    this.evalBeforeMove = null;
    this.pedagogyDone = false;
    this.warmFen = null;
  }
}
