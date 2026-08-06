import { GameEventBus } from '../events/GameEventBus';
import { MoveManager } from './MoveManager';
import { HeatmapService } from './HeatmapService';
import { EngineManager } from '../engine/EngineManager';

export class AnalysisPipeline {
  constructor(
    private eventBus: GameEventBus,
    private moveManager: MoveManager,
    private engineManager: EngineManager
  ) {
    this.setupListeners();
  }

  private setupListeners() {
    this.eventBus.on('MovePlayed', ({ move }) => {
      // 1. Move Validator
      const legal = this.moveManager.playMove(move);
      const fen = this.moveManager.getFen();
      
      if (legal) {
        this.eventBus.emit('PositionChanged', { fen });
        
        // 2. Heatmap Calculator
        const heatmap = HeatmapService.calculateInfluence(this.moveManager.getPosition());
        this.eventBus.emit('HeatmapUpdated', heatmap);

        // 3. Engine (Triggers evaluation update asynchronously)
        this.engineManager.analyze(fen, 15);
      } else {
        // Force the board to snap back to the current valid FEN if the move was illegal
        this.eventBus.emit('PositionChanged', { fen });
      }
    });

    // Also trigger pipeline on manual position changes (e.g. undo/redo)
    this.eventBus.on('PositionChanged', ({ fen }) => {
      // In a full implementation, we'd sync MoveManager pos with fen here if needed.
      const heatmap = HeatmapService.calculateInfluence(this.moveManager.getPosition());
      this.eventBus.emit('HeatmapUpdated', heatmap);
      this.engineManager.analyze(fen, 15);
    });
  }

  public initialize(fen?: string) {
    const currentFen = fen || this.moveManager.getFen();
    this.eventBus.emit('PositionChanged', { fen: currentFen });
  }
}
