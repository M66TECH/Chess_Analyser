import { GameEventBus } from '../events/GameEventBus';
import { MoveManager } from '../services/MoveManager';
import { EngineManager } from '../engine/EngineManager';
import { AnalysisPipeline } from '../services/AnalysisPipeline';
import { PgnParser } from '../parser/PgnParser';
import { OpeningBook } from '../pedagogy/OpeningBook';

export class GameManager {
  public eventBus: GameEventBus;
  public moveManager: MoveManager;
  public engineManager: EngineManager;
  public pipeline: AnalysisPipeline;

  private navigationIndex: number = -1; // -1 means "live" position

  constructor() {
    this.eventBus = new GameEventBus();
    this.moveManager = new MoveManager();
    this.engineManager = new EngineManager(this.eventBus);
    this.pipeline = new AnalysisPipeline(
      this.eventBus,
      this.moveManager,
      this.engineManager
    );
  }

  public init() {
    this.engineManager.init();
    this.pipeline.initialize();
  }

  public playMove(uci: string) {
    this.navigationIndex = -1; // Exit navigation mode on new move
    this.eventBus.emit('MovePlayed', { fen: this.moveManager.getFen(), move: uci });
  }

  public navigateTo(index: number) {
    const fen = this.moveManager.getFenAtIndex(index);
    if (fen === null) return;
    this.navigationIndex = index;
    const moveIndex = index > 0 ? index - 1 : -1;
    // C2 — NavigateTo AVANT l'appel à analyze() pour que le listener annule pendingMove d'abord
    this.eventBus.emit('NavigateTo', { fen, moveIndex });
    this.eventBus.emit('PositionChanged', { fen });
    this.engineManager.analyze(fen, 14);
  }

  public navigateFirst() {
    this.navigateTo(0);
  }

  public navigateLast() {
    const total = this.moveManager.getMoveCount();
    this.navigateTo(total);
  }

  public navigatePrev() {
    const current = this.navigationIndex === -1 
      ? this.moveManager.getMoveCount() 
      : this.navigationIndex;
    if (current > 0) this.navigateTo(current - 1);
  }

  public navigateNext() {
    const total = this.moveManager.getMoveCount();
    const current = this.navigationIndex === -1 ? total : this.navigationIndex;
    if (current < total) this.navigateTo(current + 1);
  }

  public flipBoard() {
    // Will be handled at UI level
  }

  public getMoveRecords() {
    return this.pipeline.getMoveRecords();
  }

  /**
   * C1 — resetGame() ne détruit plus les listeners du pipeline.
   * On appelle pipeline.reset() qui vide l'état interne sans toucher aux subscriptions.
   * engineManager.reinit() envoie ucinewgame pour nettoyer la hash table.
   */
  public resetGame() {
    this.pipeline.reset();
    this.moveManager.reset();
    this.engineManager.reinit();
    this.navigationIndex = -1;

    // Réinitialiser la position de départ
    const startFen = this.moveManager.getFen();
    this.eventBus.emit('PositionChanged', { fen: startFen });
    this.engineManager.analyze(startFen, 14);
  }

  /**
   * E5 — Charger une partie depuis des coups UCI (issus du PGN parser).
   * Joue tous les coups silencieusement, puis initialise l'analyse de la position finale.
   */
  public loadPgn(pgnText: string): { success: boolean; error?: string; moveCount?: number } {
    const result = PgnParser.parse(pgnText);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Reset silencieux sans analyse intermédiaire
    this.pipeline.reset();
    this.moveManager.reset();
    this.engineManager.reinit();
    this.navigationIndex = -1;

    // Rejouer tous les coups silencieusement
    let loadedCount = 0;
    for (const uci of result.moves) {
      const playResult = this.moveManager.playMove(uci);
      if (!playResult.success) {
        console.warn(`[GameManager.loadPgn] Coup illégal à l'index ${loadedCount}: ${uci}`);
        break;
      }
      loadedCount++;
    }

    // Émettre les événements de position finale
    const finalFen = this.moveManager.getFen();
    this.eventBus.emit('PositionChanged', { fen: finalFen });

    // Signaler l'ouverture si détectée
    const opening = this.moveManager.getUciMoves().length > 0
      ? OpeningBook.lookup(this.moveManager.getUciMoves())
      : null;
    if (opening) {
      this.eventBus.emit('OpeningDetected', { eco: opening.eco, name: opening.name });
    }

    return { success: true, moveCount: loadedCount };
  }

  public terminate() {
    this.engineManager.terminate();
  }
}
