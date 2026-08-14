import { GameEventBus, EngineEvaluation } from '../events/GameEventBus';
import { MoveManager } from './MoveManager';
import { EngineManager } from '../engine/EngineManager';
import { EvalNormalizer } from '../analysis/EvalNormalizer';
import { MoveClassifier } from '../pedagogy/MoveClassifier';
import { EvalCache } from '../cache/EvalCache';
import { OpeningExplorer } from '../explorer/OpeningExplorer';
import { MoveAnalysis, MoveRecord } from '../pedagogy/types';

export class AnalysisPipeline {
  private evalCache = new EvalCache();
  private moveRecords: MoveRecord[] = [];
  
  // State for the currently analyzing move
  private pendingMove: { uci: string; san: string; fenBefore: string; fenAfter: string; color: 'white'|'black'; nodeId: string } | null = null;
  private evalBeforeMove: EngineEvaluation | null = null;
  private pedagogyDone = false;

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

      // Retrieve eval BEFORE the move was played
      let evalBefore = await this.evalCache.get(fenBefore);
      if (!evalBefore) {
        // Fallback if not cached
        evalBefore = { depth: 0, cp: 0, pv: [] };
      }
      this.evalBeforeMove = evalBefore;
      this.pedagogyDone = false;

      this.pendingMove = {
        uci: move,
        san,
        fenBefore,
        fenAfter,
        color,
        nodeId
      };

      // Emit new position
      this.eventBus.emit('PositionChanged', { fen: fenAfter });

      // Fetch opening asynchronously
      OpeningExplorer.fetch(fenAfter).then(data => {
        if (data && data.opening) {
          this.eventBus.emit('OpeningDetected', { eco: data.opening.eco, name: data.opening.name });
        }
      });

      // Launch engine
      this.engineManager.analyze(fenAfter, 14); // Target depth 14 for speed
    });

    this.eventBus.on('EngineEvaluationUpdated', (evaluation) => {
      if (!this.pendingMove) return;

      // Cache the evaluation
      this.evalCache.set(this.pendingMove.fenAfter, evaluation);

      // We can emit partial progress here if we want the UI to show thinking progress
      
      // Run pedagogy when reaching target depth
      if (!this.pedagogyDone && evaluation.depth >= 14) {
        this.pedagogyDone = true;
        this.runPedagogy(evaluation);
      }
    });
  }

  private runPedagogy(evalAfter: EngineEvaluation) {
    if (!this.pendingMove || !this.evalBeforeMove) return;

    const { uci, san, fenBefore, fenAfter, color } = this.pendingMove;
    const moveNumber = this.moveManager.getCurrentMoveNumber();

    // 1. Normalize scores (White's POV)
    const normCpBefore = EvalNormalizer.normalize(this.evalBeforeMove.cp, this.evalBeforeMove.mate);
    const normCpAfter = EvalNormalizer.normalize(evalAfter.cp, evalAfter.mate);

    // 2. Win difference (from player's POV)
    const winDiff = EvalNormalizer.winningChancesDiff(normCpBefore, normCpAfter, color);

    // 3. Classification
    // Mate sequences handled: MateCreated (after move mate is forced), MateLost (before move mate was forced)
    const { classification, accuracy } = MoveClassifier.classify(
      winDiff,
      this.evalBeforeMove.mate,
      evalAfter.mate,
      normCpBefore
    );

    // Best move from BEFORE the move
    const bestMove = this.evalBeforeMove.pv.length > 0 ? this.evalBeforeMove.pv[0] : undefined;

    const analysis: MoveRecord = {
      fenBefore,
      fenAfter,
      playedMove: uci,
      bestMove,
      cpBefore: normCpBefore,
      mateBefore: this.evalBeforeMove.mate,
      cpAfter: normCpAfter,
      mateAfter: evalAfter.mate,
      winProbBefore: EvalNormalizer.cpToWinningChances(normCpBefore), // Just for display
      winProbAfter: EvalNormalizer.cpToWinningChances(normCpAfter),
      accuracy,
      classification,
      moveNumber,
      color,
      san,
      nodeId: this.pendingMove.nodeId,
    };

    this.moveRecords.push(analysis);
    this.eventBus.emit('PedagogyUpdated', analysis);
    this.eventBus.emit('MoveRecorded', analysis);
    
    // We don't clear pendingMove here because engine might still find deeper evals
    // But we set pedagogyDone = true to avoid repeating
  }

  public initialize(fen?: string) {
    const currentFen = fen || this.moveManager.getFen();
    this.eventBus.emit('PositionChanged', { fen: currentFen });
    this.engineManager.analyze(currentFen, 14);
  }

  public getMoveRecords(): MoveRecord[] {
    return [...this.moveRecords];
  }

  public reset() {
    this.moveRecords = [];
    this.pendingMove = null;
    this.evalBeforeMove = null;
    this.pedagogyDone = false;
  }
}
