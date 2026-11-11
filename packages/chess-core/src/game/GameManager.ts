import { GameEventBus } from '../events/GameEventBus';
import { MoveManager } from '../services/MoveManager';
import { EngineManager, DEFAULT_TARGET_DEPTH, MAX_CONTINUOUS_DEPTH } from '../engine/EngineManager';
import { AnalysisPipeline } from '../services/AnalysisPipeline';
import { PgnParser } from '../parser/PgnParser';
import { MoveNode, MoveRecord } from '../pedagogy/types';

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

  public playMove(uci: string): { success: boolean; nodeId?: string; san?: string } {
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
      return { success: true, nodeId: result.nodeId, san: result.san };
    }
    return { success: false };
  }

  public async navigateToNode(nodeId: string | null) {
    if (this.moveManager.goToNode(nodeId)) {
      this.activeNodeId = nodeId;
      this.isNavigating = true;
      const fen = this.moveManager.getFen();
      // On passe nodeId au lieu de moveIndex
      this.eventBus.emit('NavigateTo', { fen, nodeId });
      this.eventBus.emit('PositionChanged', { fen });

      // Succession 1 : Émission immédiate du cache pour réactivité instantanée à la navigation
      const cached = await this.pipeline.getEvalCache().get(fen);
      if (cached) {
        this.eventBus.emit('EngineEvaluationUpdated', cached);
        // Si c'est un mat résolu ou déjà analysé à profondeur maximale, pas besoin de relancer
        if (typeof cached.mate === 'number' || cached.depth >= MAX_CONTINUOUS_DEPTH) {
          return;
        }
      }

      // Succession 2 : Approfondissement continu (deepen) en tâche de fond au-delà de la cible
      this.engineManager.analyze(fen, DEFAULT_TARGET_DEPTH, undefined, true);
    }
  }

  public navigateFirst() {
    this.navigateToNode(null);
  }

  public navigateLast() {
    // Va à la fin de la ligne courante en partant de la racine, sinon on ne
    // parcourt que les enfants du nœud courant et on s'arrête immédiatement.
    const tree = this.moveManager.getTree();
    const roots = Array.from(tree.nodes.values()).filter(n => n.parentId === null);
    let current = roots.length > 0 ? roots[0].id : null;

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

  public resetGame() {
    this.pipeline.reset();
    this.moveManager.reset();
    this.engineManager.reinit();
    this.activeNodeId = null;
    this.isNavigating = false;

    // Réinitialiser la position de départ
    const startFen = this.moveManager.getFen();
    this.eventBus.emit('PositionChanged', { fen: startFen });
    this.engineManager.analyze(startFen, DEFAULT_TARGET_DEPTH, undefined, true);
  }

  public async loadPgn(pgnText: string): Promise<{ success: boolean; error?: string; moveCount?: number }> {
    const result = PgnParser.parse(pgnText);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Reset silencieux avec le FEN personnalisé du PGN s'il est présent
    const setupFen = result.headers['FEN'];
    this.pipeline.reset();
    this.moveManager.reset(setupFen);
    this.engineManager.reinit();
    this.activeNodeId = null;
    this.isNavigating = false;

    // Rejouer tous les coups silencieusement à partir de la position initiale du PGN.
    const nodes: MoveNode[] = [];
    for (const uci of result.moves) {
      const playResult = this.moveManager.playMove(uci);
      if (!playResult.success) {
        console.warn(`[GameManager.loadPgn] Coup illégal à l'index ${nodes.length}: ${uci}`);
        break;
      }
      const node = playResult.nodeId ? this.moveManager.getTree().nodes.get(playResult.nodeId) : null;
      if (node) nodes.push(node);
      this.activeNodeId = playResult.nodeId ?? this.activeNodeId;
    }

    // Émettre l'événement de position finale
    const finalFen = this.moveManager.getFen();
    this.eventBus.emit('PositionChanged', { fen: finalFen });
    this.eventBus.emit('NavigateTo', { fen: finalFen, nodeId: this.moveManager.getTree().currentNodeId });

    // Analyser chaque position séquentiellement (records/coach/graphe)
    await this.pipeline.analyzeGame(nodes);

    return { success: true, moveCount: nodes.length };
  }

  /**
   * Restaure une partie sauvegardée (coups UCI + `MoveRecord` déjà calculés)
   * sans déclencher d'analyses concurrentes avortées sur chaque coup.
   */
  public restoreSession(moves: string[], savedRecords?: MoveRecord[], initialFen?: string): boolean {
    if (!Array.isArray(moves) || moves.length === 0) return false;
    this.pipeline.reset();
    this.moveManager.reset(initialFen);
    this.activeNodeId = null;
    this.isNavigating = false;

    const nodes: MoveNode[] = [];
    for (const uci of moves) {
      const res = this.moveManager.playMove(uci);
      if (!res.success) break;
      const node = res.nodeId ? this.moveManager.getTree().nodes.get(res.nodeId) : null;
      if (node) nodes.push(node);
      this.activeNodeId = res.nodeId ?? this.activeNodeId;
    }

    if (nodes.length === 0) return false;

    if (savedRecords && savedRecords.length > 0) {
      // Réassocier par index sur la branche principale si les nodeId ont changé
      const remapped = savedRecords.map((rec, idx) =>
        nodes[idx] ? { ...rec, nodeId: nodes[idx].id } : rec
      );
      this.pipeline.restoreMoveRecords(remapped);
    }

    const finalFen = this.moveManager.getFen();
    this.eventBus.emit('PositionChanged', { fen: finalFen });
    this.eventBus.emit('NavigateTo', { fen: finalFen, nodeId: this.activeNodeId });
    this.engineManager.analyze(finalFen, DEFAULT_TARGET_DEPTH, undefined, true);
    return true;
  }

  public terminate() {
    this.engineManager.terminate();
  }
}

