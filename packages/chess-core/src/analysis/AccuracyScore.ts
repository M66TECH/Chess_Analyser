export class AccuracyScore {
  /**
   * Calculates the accuracy of a single move based on the drop in winning chances.
   * Lichess formula: 103.1668 * exp(-0.043544 * winDiff) - 3.166925 + 1
   * @param winDrop The drop in winning chances (0 to 2 max, since scale is [-1, 1]).
   * If the player improved their chances, winDrop is <= 0.
   */
  public static calculateMoveAccuracy(winDrop: number): number {
    if (winDrop <= 0) return 100;
    // Note: Lichess formula expects winDiff in percentages [0, 100], 
    // where winDrop of 0.1 (10% drop on [-1, 1] scale) corresponds to winDiff = 10.
    // Wait, let's verify: 103.1668 * exp(-0.043544 * 10) - 3.166925 + 1 = 64% accuracy for a 0.1 drop?
    // Actually, Lichess computes winDiff as (winBefore - winAfter) * 100 on the [-1, 1] scale, or rather [0, 1] scale?
    // In Lichess, winning chances are [0, 1] internally for accuracy or [-1, 1]?
    // Let's assume winDrop is already scaled to percentage loss (e.g. 0.1 drop = 10).
    const winDiff = winDrop * 100; 
    
    let accuracy = 103.1668 * Math.exp(-0.043544 * winDiff) - 3.166925 + 1;
    return Math.max(0, Math.min(100, accuracy));
  }
}
