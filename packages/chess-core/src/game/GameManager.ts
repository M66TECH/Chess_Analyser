import { GameEventBus } from '../events/GameEventBus';
import { MoveManager } from '../services/MoveManager';
import { EngineManager } from '../engine/EngineManager';
import { AnalysisPipeline } from '../services/AnalysisPipeline';
import { PgnParser } from '../parser/PgnParser';

export class GameManager {
  public eventBus: GameEventBus;
  public moveManager: MoveManager;
  public engineManager: EngineManager;
  public pipeline: AnalysisPipeline;

  private activeNodeId: string | null = null;
  private isNavigating: boolean = false;

  constructor() {
    this.eventBus = new GameEventBus();
    this.moveManager = new MoveManager();
    this.engineManager = new EngineManager(this.eventBus);
    this.pipeline = new AnalysisPipeline(this.eventBus, this.moveManager, this.engineManager);
  }

  public init() {
    this.engineManager.init();
    this.pipeline.initialize();
  }

  public playMove(uci: string) {
    this.isNavigating = false;
    const fenBefore = this.moveManager.getFen();
    const result = this.moveManager.playMove(uci);
    if (result.success && result.nodeId) {
      this.activeNodeId = result.nodeId;
      this.eventBus.emit('MovePlayed', { 
        fenBefore, 
        fenAfter: this.moveManager.getFen(), 
        move: uci, 
        nodeId: result.nodeId 
      });
    }
  }

  public navigateToNode(nodeId: string | null) {
    if (this.moveManager.goToNode(nodeId)) {
      this.activeNodeId = nodeId;
      this.isNavigating = true;
      const fen = this.moveManager.getFen();
      // On passe nodeId au lieu de moveIndex
      this.eventBus.emit('NavigateTo', { fen, nodeId });
      this.eventBus.emit('PositionChanged', { fen });
      this.engineManager.analyze(fen, 14);
    }
  }

  public navigateFirst() {
    this.navigateToNode(null);
  }

  public navigateLast() {
    // Va à la fin de la ligne courante
    let current = this.activeNodeId;
    const tree = this.moveManager.getTree();
    if (!current) {
      // Find root mainline node
      const roots = Array.from(tree.nodes.values()).filter(n => n.parentId === null);
      if (roots.length > 0) current = roots[0].id;
    }
    
    while (current) {
      const node = tree.nodes.get(current);
      if (node && node.childrenIds.length > 0) {
        current = node.childrenIds[0]; // always pick first child (mainline)
      } else {
        break;
      }
    }
    if (current) this.navigateToNode(current);
  }

  public navigatePrev() {
    if (!this.activeNodeId) return;
    const tree = this.moveManager.getTree();
    const node = tree.nodes.get(this.activeNodeId);
    if (node) {
      this.navigateToNode(node.parentId);
    }
  }

  public navigateNext() {
    const tree = this.moveManager.getTree();
    if (!this.activeNodeId) {
      // From root, go to first move
      const roots = Array.from(tree.nodes.values()).filter(n => n.parentId === null);
      if (roots.length > 0) this.navigateToNode(roots[0].id);
      return;
    }
    
    const node = tree.nodes.get(this.activeNodeId);
    if (node && node.childrenIds.length > 0) {
      this.navigateToNode(node.childrenIds[0]);
    }
  }

  public flipBoard() {
    // Will be handled at UI level
  }

  public getMoveRecords() {
    return this.pipeline.getMoveRecords();
  }

  public getTree() {
    return this.moveManager.getTree();
  }

  public getActiveNodeId() {
    return this.activeNodeId;
  }

  public setLanguageLevel(level: 'beginner' | 'intermediate' | 'advanced') {
    // To be re-implemented
  }

  public resetGame() {
    this.pipeline.reset();
    this.moveManager.reset();
    this.engineManager.reinit();
    this.activeNodeId = null;
    this.isNavigating = false;

    // Réinitialiser la position de départ
    const startFen = this.moveManager.getFen();
    this.eventBus.emit('PositionChanged', { fen: startFen });
    this.engineManager.analyze(startFen, 14);
  }

  public loadPgn(pgnText: string): { success: boolean; error?: string; moveCount?: number } {
    const result = PgnParser.parse(pgnText);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Reset silencieux sans analyse intermédiaire
    this.pipeline.reset();
    this.moveManager.reset();
    this.engineManager.reinit();
    this.activeNodeId = null;
    this.isNavigating = false;

    // Rejouer tous les coups silencieusement
    let loadedCount = 0;
    let lastNodeId: string | null = null;
    for (const uci of result.moves) {
      const playResult = this.moveManager.playMove(uci);
      if (!playResult.success) {
        console.warn(`[GameManager.loadPgn] Coup illégal à l'index ${loadedCount}: ${uci}`);
        break;
      }
      lastNodeId = playResult.nodeId ?? null;
      loadedCount++;
    }
    
    this.activeNodeId = lastNodeId;

    // Émettre les événements de position finale
    const finalFen = this.moveManager.getFen();
    this.eventBus.emit('PositionChanged', { fen: finalFen });



    return { success: true, moveCount: loadedCount };
  }

  public terminate() {
    this.engineManager.terminate();
  }
}

