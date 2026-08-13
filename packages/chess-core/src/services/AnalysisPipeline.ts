import { GameEventBus, EngineEvaluation } from '../events/GameEventBus';
import { MoveManager } from './MoveManager';
import { HeatmapService } from './HeatmapService';
import { EngineManager } from '../engine/EngineManager';
import { MoveClassifier } from '../pedagogy/MoveClassifier';
import { TacticalEngine } from '../pedagogy/TacticalEngine';
import { ExplanationEngine } from '../pedagogy/ExplanationEngine';
import { OpeningBook } from '../pedagogy/OpeningBook';
import { MoveAnalysis, MoveRecord } from '../pedagogy/types';

const ANALYSIS_DEPTH = 14;

export class AnalysisPipeline {
  // E1 — Dernière évaluation réelle du moteur (toute profondeur), mise à jour en continu
  private lastKnownEval: EngineEvaluation | null = null;
  // Évaluation sauvegardée AVANT le coup (pour calculer la perte de probabilité)
  private previousEval: EngineEvaluation | null = null;
  private currentEval: EngineEvaluation | null = null;
  private pendingMove: { uci: string; san: string; fenBefore: string; fenAfter: string } | null = null;
  private pedagogyDone = false; // prevents multiple pedagogy runs per move
  private moveRecords: MoveRecord[] = [];

  // C2 — Tracker le FEN actuellement analysé pour détecter les races conditions
  private currentAnalysisFen: string | null = null;

  // C4 — Meilleure évaluation reçue pour la position APRÈS le coup (proxy pour bestMoveCp)
  private firstEvalForPendingFen: EngineEvaluation | null = null;

  private unsubscribers: Array<() => void> = [];

  constructor(
    private eventBus: GameEventBus,
    private moveManager: MoveManager,
    private engineManager: EngineManager
  ) {
    this.setupListeners();
  }

  private setupListeners() {
    // C1 — Stocker les fonctions de désinscription pour pouvoir les ré-inscrire après un reset
    const unsub1 = this.eventBus.on('MovePlayed', ({ move }) => {
      // E1 — Utiliser lastKnownEval (dernière éval réelle) et non {cp:0} par défaut
      this.previousEval = this.lastKnownEval;
      this.pedagogyDone = false;
      this.firstEvalForPendingFen = null;

      const result = this.moveManager.playMove(move);
      const fen = this.moveManager.getFen();

      if (result.success && result.fenBefore !== undefined) {
        this.pendingMove = {
          uci: move,
          san: result.san ?? move,
          fenBefore: result.fenBefore,
          fenAfter: fen,
        };

        // C2 — Tracker le FEN analysé
        this.currentAnalysisFen = fen;

        // Emit updated position
        this.eventBus.emit('PositionChanged', { fen });

        // Compute heatmap for new position
        const heatmap = HeatmapService.calculateInfluence(this.moveManager.getPosition());
        this.eventBus.emit('HeatmapUpdated', heatmap);

        // Check opening book
        const uciMoves = this.moveManager.getUciMoves();
        const opening = OpeningBook.lookup(uciMoves);
        if (opening) {
          this.eventBus.emit('OpeningDetected', { eco: opening.eco, name: opening.name });
        }

        // Launch engine analysis
        this.currentEval = null;
        this.engineManager.analyze(fen, ANALYSIS_DEPTH);
      } else {
        // Illegal move — snap back
        this.eventBus.emit('PositionChanged', { fen });
        this.pendingMove = null;
      }
    });

    const unsub2 = this.eventBus.on('EngineEvaluationUpdated', (evaluation) => {
      // E1 — Toujours mettre à jour lastKnownEval, quelle que soit la profondeur
      this.lastKnownEval = evaluation;
      this.currentEval = evaluation;

      // C4 — Sauvegarder la première éval reçue pour fenAfter (proxy bestMoveCp)
      if (
        this.pendingMove &&
        this.currentAnalysisFen === this.pendingMove.fenAfter &&
        this.firstEvalForPendingFen === null
      ) {
        this.firstEvalForPendingFen = evaluation;
      }

      // C2 — Race condition fix : vérifier que l'éval correspond au pendingMove.fenAfter
      if (
        this.pendingMove &&
        this.previousEval !== null &&
        !this.pedagogyDone &&
        evaluation.depth >= ANALYSIS_DEPTH &&
        this.currentAnalysisFen === this.pendingMove.fenAfter  // ← validation critique
      ) {
        this.pedagogyDone = true;
        this.runPedagogy(evaluation);
      }
    });

    // E3 — S'abonner à AnalysisFinished : déclencher la pédagogie si depth < 14 (ex: mat trouvé)
    const unsub3 = this.eventBus.on('AnalysisFinished', () => {
      if (
        this.pendingMove &&
        this.previousEval !== null &&
        !this.pedagogyDone &&
        this.currentEval !== null &&
        this.currentAnalysisFen === this.pendingMove.fenAfter
      ) {
        this.pedagogyDone = true;
        this.runPedagogy(this.currentEval);
      }
    });

    // C2 — Annuler pendingMove quand l'utilisateur navigue (évite l'attribution erronée)
    const unsub4 = this.eventBus.on('NavigateTo', () => {
      this.pendingMove = null;
      this.pedagogyDone = false;
      this.firstEvalForPendingFen = null;
      // currentAnalysisFen sera mis à jour par l'appel à analyze() dans navigateTo()
    });

    this.unsubscribers = [unsub1, unsub2, unsub3, unsub4];
  }

  private runPedagogy(evaluation: EngineEvaluation) {
    if (!this.previousEval || !this.pendingMove) return;

    const { uci, san, fenBefore, fenAfter } = this.pendingMove;
    const uciMoves = this.moveManager.getUciMoves();
    const moveNumber = this.moveManager.getCurrentMoveNumber();
    // Determine color: white played on odd counts (1, 3, 5…), black on even
    const color = this.moveManager.getMoveCount() % 2 === 1 ? 'white' : 'black';

    const opening = OpeningBook.lookup(uciMoves);

    // Check if this is a book move
    const isBook = OpeningBook.isBookMove(uciMoves);

    // C4 — bestMoveCp : utiliser la première éval reçue pour la position après le coup
    // comme proxy du meilleur coup moteur (depth ≥ 1). Null si non disponible.
    const bestMoveCp = this.firstEvalForPendingFen?.cp;

    // Classification
    const { classification, winProbBefore, winProbAfter, accuracy } = MoveClassifier.classify(
      this.previousEval.cp,
      evaluation.cp,
      this.previousEval.mate,
      evaluation.mate,
      bestMoveCp
    );

    // Tactical analysis
    const motifs = TacticalEngine.analyze(this.moveManager.getPosition());

    // Generate explanation
    const probDrop = winProbBefore - winProbAfter;
    const explanation = ExplanationEngine.generateExplanation(
      isBook ? 'book' : classification,
      motifs,
      probDrop,
      accuracy
    );

    // Best move suggestion from previousEval PV (best move for the position before the played move)
    const bestMove = this.previousEval.pv.length > 0 ? this.previousEval.pv[0] : undefined;

    // Compile analysis
    const analysis: MoveAnalysis = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,  // M12 — id moins collision-prone
      fenBefore,
      fenAfter,
      playedMove: uci,
      bestMove,
      cpBefore: this.previousEval.cp,
      mateBefore: this.previousEval.mate,
      cpAfter: evaluation.cp,
      mateAfter: evaluation.mate,
      winProbBefore,
      winProbAfter,
      accuracy,
      classification: isBook ? 'book' : classification,
      tacticalMotifs: motifs,
      explanation,
      opening: opening?.name,
      moveNumber,
      color,
      san,
    };

    this.eventBus.emit('PedagogyUpdated', analysis);

    // Record move
    const record: MoveRecord = {
      moveNumber,
      color,
      san,
      uci,
      fenBefore,
      fenAfter,
      cpBefore: this.previousEval.cp,
      cpAfter: evaluation.cp,
      mateBefore: this.previousEval.mate,
      mateAfter: evaluation.mate,
      winProbBefore,
      winProbAfter,
      accuracy,
      classification: isBook ? 'book' : classification,
      tacticalMotifs: motifs,
      explanation,
      bestMove,
      opening: opening?.name,
    };

    this.moveRecords.push(record);
    this.eventBus.emit('MoveRecorded', record);

    this.pendingMove = null;
  }

  public initialize(fen?: string) {
    const currentFen = fen || this.moveManager.getFen();
    const heatmap = HeatmapService.calculateInfluence(this.moveManager.getPosition());
    this.eventBus.emit('PositionChanged', { fen: currentFen });
    this.eventBus.emit('HeatmapUpdated', heatmap);
    this.currentAnalysisFen = currentFen;
    this.engineManager.analyze(currentFen, ANALYSIS_DEPTH);
  }

  /**
   * C1 — Réinitialiser l'état interne du pipeline SANS supprimer les listeners.
   * Appelé par GameManager.resetGame() à la place de eventBus.clear().
   */
  public reset() {
    this.lastKnownEval = null;
    this.previousEval = null;
    this.currentEval = null;
    this.pendingMove = null;
    this.pedagogyDone = false;
    this.moveRecords = [];
    this.currentAnalysisFen = null;
    this.firstEvalForPendingFen = null;
  }

  public getMoveRecords(): MoveRecord[] {
    return [...this.moveRecords];
  }
}
