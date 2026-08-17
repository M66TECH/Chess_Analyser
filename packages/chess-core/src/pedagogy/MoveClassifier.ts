import { MoveClassification } from './types';
import { AccuracyScore } from '../analysis/AccuracyScore';

export class MoveClassifier {
  /**
   * Classify a move based on winning chances drop (winDrop) on the [-1, 1] scale.
   * Conventions (Lichess): winDrop >= 0.3 -> Blunder, >= 0.2 -> Mistake, >= 0.1 -> Inaccuracy.
   * Negative winDrop means the player IMPROVED their chances.
   * Mate scores are already folded into centipawns by EvalNormalizer, so they flow
   * through this same logic instead of being handled with fragile heuristics.
   * @param winDrop Chances lost by the player (positive = worse, negative = better)
   * @param isBestMove True when the played move equals the engine's best move
   */
  public static classify(
    winDrop: number,
    isBestMove: boolean = false
  ): { classification: MoveClassification; accuracy: number } {
    const accuracy = AccuracyScore.calculateMoveAccuracy(winDrop);
    let classification: MoveClassification = 'good';

    if (winDrop >= 0.3) {
      classification = 'blunder';
    } else if (winDrop >= 0.2) {
      classification = 'mistake';
    } else if (winDrop >= 0.1) {
      classification = 'inaccuracy';
    } else if (winDrop <= -0.1) {
      // Big improvement — brilliant only if it was NOT the engine's top pick
      classification = isBestMove ? 'best' : 'brilliant';
    } else if (winDrop <= -0.05) {
      classification = isBestMove ? 'best' : 'great';
    } else if (isBestMove) {
      classification = 'best';
    } else {
      classification = 'good';
    }

    return { classification, accuracy };
  }
}
