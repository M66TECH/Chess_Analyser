import { MoveClassification } from './types';
import { AccuracyScore } from '../analysis/AccuracyScore';

export class MoveClassifier {
  /**
   * Classify a move based on winning chances difference (delta) on the [-1, 1] scale.
   * Conventions: delta <= -0.3 -> Blunder, <= -0.2 -> Mistake, <= -0.1 -> Inaccuracy.
   * Handles Mate sequences.
   */
  public static classify(
    winDrop: number,
    mateBefore: number | undefined,
    mateAfter: number | undefined,
    cpBefore: number | undefined
  ): { classification: MoveClassification; accuracy: number } {
    const accuracy = AccuracyScore.calculateMoveAccuracy(winDrop);
    let classification: MoveClassification = 'good';

    // Mate sequences logic
    if (mateBefore === undefined && mateAfter !== undefined) {
      // MateCreated (opponent is getting mated)
      // This is evaluated based on the previous CP
      if (cpBefore !== undefined) {
        if (cpBefore < -999) classification = 'inaccuracy';
        else if (cpBefore < -700) classification = 'mistake';
        else classification = 'blunder'; // Losing a completely drawn/winning game to mate
      }
      return { classification, accuracy };
    }

    if (mateBefore !== undefined && mateAfter === undefined) {
      // MateLost (you had a forced mate and lost it)
      classification = 'blunder'; // Simplification: losing a forced mate is generally a blunder
      return { classification, accuracy };
    }

    if (mateBefore !== undefined && mateAfter !== undefined) {
      // MateDelayed
      return { classification: 'good', accuracy };
    }

    // Normal CP delta logic
    // winDrop is positive when the player LOST winning chances.
    // Lichess threshold uses `delta <= -X` where delta is `winAfter - winBefore` (negative means drop).
    // So `winDrop >= 0.3` means `delta <= -0.3`.
    if (winDrop >= 0.3) {
      classification = 'blunder';
    } else if (winDrop >= 0.2) {
      classification = 'mistake';
    } else if (winDrop >= 0.1) {
      classification = 'inaccuracy';
    } else if (winDrop <= -0.05) {
      classification = 'great'; // Slight improvement in chances
    } else if (winDrop <= -0.1) {
      classification = 'brilliant'; // Massive improvement in chances
    } else if (winDrop <= 0.02) {
      classification = 'best'; // Within a very small margin
    } else {
      classification = 'good';
    }

    return { classification, accuracy };
  }
}
