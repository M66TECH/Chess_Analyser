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

  public static computeGameStats(records: any[]): any {
    const stats = {
      accuracy: { white: 100, black: 100 },
      acpl: { white: 0, black: 0 },
      blunders: { white: 0, black: 0 },
      mistakes: { white: 0, black: 0 },
      inaccuracies: { white: 0, black: 0 },
    };

    let wAccSum = 0, bAccSum = 0;
    let wCpSum = 0, bCpSum = 0;
    let wCount = 0, bCount = 0;

    for (const r of records) {
      if (r.color === 'white') {
        wAccSum += r.accuracy;
        wCpSum += Math.max(0, r.cpBefore - r.cpAfter);
        wCount++;
        if (r.classification === 'blunder') stats.blunders.white++;
        if (r.classification === 'mistake') stats.mistakes.white++;
        if (r.classification === 'inaccuracy') stats.inaccuracies.white++;
      } else {
        bAccSum += r.accuracy;
        // black cp is inverted in normalize (it's always white's POV), but wait!
        // `cpBefore` and `cpAfter` in MoveRecord are already normalized to White's POV!
        // If Black plays, they want the evaluation to go DOWN (more negative).
        // So Black centipawn loss is: (cpAfter - cpBefore) if we use White's POV.
        // Actually, centipawn loss is always positive. 
        // Lichess standard ACPL caps the loss at 1000 or similar. Let's just use absolute loss.
        // Wait, if it's White's POV, Black playing a good move makes CP go from +100 to -100.
        // If Black plays a bad move, CP goes from -100 to +100. 
        // So Black loss is: cpAfter - cpBefore.
        bCpSum += Math.max(0, r.cpAfter - r.cpBefore);
        bCount++;
        if (r.classification === 'blunder') stats.blunders.black++;
        if (r.classification === 'mistake') stats.mistakes.black++;
        if (r.classification === 'inaccuracy') stats.inaccuracies.black++;
      }
    }

    stats.accuracy.white = wCount > 0 ? Math.round((wAccSum / wCount) * 10) / 10 : 100;
    stats.accuracy.black = bCount > 0 ? Math.round((bAccSum / bCount) * 10) / 10 : 100;
    
    stats.acpl.white = wCount > 0 ? Math.round(wCpSum / wCount) : 0;
    stats.acpl.black = bCount > 0 ? Math.round(bCpSum / bCount) : 0;

    return stats;
  }
}
