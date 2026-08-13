import { MoveClassification } from './types';

export class MoveClassifier {
  /**
   * Converts centipawns to win probability using Lichess's formula.
   * Returns a value between 0 (certain loss) and 1 (certain win).
   */
  public static cpToWinProb(cp: number): number {
    const clamped = Math.max(-10000, Math.min(10000, cp));
    return 1 / (1 + Math.exp(-0.00368208 * clamped));
  }

  /**
   * Converts a win probability change to an accuracy score (0-100).
   * Uses the Lichess accuracy formula.
   */
  public static winProbToAccuracy(winProbBefore: number, winProbAfter: number): number {
    const probDrop = Math.max(0, winProbBefore - winProbAfter);
    // Lichess-style accuracy: 103.1668 * exp(-0.04354 * probDrop * 100) - 3.1669
    const accuracy = 103.1668 * Math.exp(-0.04354 * probDrop * 100) - 3.1669;
    return Math.max(0, Math.min(100, accuracy));
  }

  public static classify(
    cpBefore: number | undefined,
    cpAfter: number | undefined,
    mateBefore?: number,
    mateAfter?: number,
    bestMoveCp?: number
  ): {
    classification: MoveClassification;
    winProbBefore: number;
    winProbAfter: number;
    accuracy: number;
  } {
    // Handle mate scores
    const effectiveCpBefore = mateBefore !== undefined
      ? (mateBefore > 0 ? 10000 : -10000)
      : (cpBefore ?? 0);
    const effectiveCpAfter = mateAfter !== undefined
      ? (mateAfter > 0 ? 10000 : -10000)
      : (cpAfter ?? 0);

    const winProbBefore = this.cpToWinProb(effectiveCpBefore);
    const winProbAfter = this.cpToWinProb(effectiveCpAfter);
    const accuracy = this.winProbToAccuracy(winProbBefore, winProbAfter);
    const probDrop = winProbBefore - winProbAfter;

    let classification: MoveClassification = 'good';

    if (probDrop < -0.1) {
      // M3 — Win prob INCREASED significantly → brillant uniquement si pas de bestMoveCp
      // qui prouverait que le coup n'est pas optimal selon le moteur
      classification = bestMoveCp === undefined ? 'brilliant' : 'great';
    } else if (probDrop < -0.02) {
      // Win prob increased a little → great defensive or attacking find
      classification = 'great';
    } else if (probDrop <= 0.02) {
      // Nearly equal to best move
      if (bestMoveCp !== undefined && Math.abs(effectiveCpAfter - bestMoveCp) < 10) {
        // C4 — classification 'best' maintenant accessible quand bestMoveCp est fourni
        classification = 'best';
      } else {
        classification = 'excellent';
      }
    } else if (probDrop <= 0.05) {
      classification = 'good';
    } else if (probDrop <= 0.10) {
      classification = 'inaccuracy';
    } else if (probDrop <= 0.20) {
      classification = 'mistake';
    } else {
      classification = 'blunder';
    }

    return { classification, winProbBefore, winProbAfter, accuracy };
  }
}
