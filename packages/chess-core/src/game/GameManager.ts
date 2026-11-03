import { GameEventBus } from '../events/GameEventBus';
import { MoveManager } from '../services/MoveManager';
import { EngineManager } from '../engine/EngineManager';
import { AnalysisPipeline } from '../services/AnalysisPipeline';
import { HistoryManager } from '../services/HistoryManager';

export class GameManager {
  public eventBus: GameEventBus;
  public moveManager: MoveManager;
  public engineManager: EngineManager;
  public historyManager: HistoryManager;
  public pipeline: AnalysisPipeline;

  constructor() {
    this.eventBus = new GameEventBus();
    this.moveManager = new MoveManager();
    this.engineManager = new EngineManager(this.eventBus);
    this.historyManager = new HistoryManager();
    
    this.pipeline = new AnalysisPipeline(
      this.eventBus,
      this.moveManager,
      this.engineManager
    );

    // Initialize Engine
    this.engineManager.init();

    // Track history automatically
    this.eventBus.on('PositionChanged', ({ fen }) => {
      this.historyManager.addPosition(fen);
    });
  }

  public init() {
    this.pipeline.initialize();
  }

  public playMove(uci: string) {
    this.eventBus.emit('MovePlayed', { fen: this.moveManager.getFen(), move: uci });
  }
}
