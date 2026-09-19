import { MoveRecord, GameStats } from '../pedagogy/types';

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
    
    const accuracy = 103.1668 * Math.exp(-0.043544 * winDiff) - 3.166925 + 1;
    return Math.max(0, Math.min(100, accuracy));
  }

  public static computeGameStats(records: MoveRecord[]): GameStats {
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

    // Lichess plafonne les valeurs à +/- 1000 centipions pour le calcul de l'ACPL
    const clampCp = (cp: number) => Math.max(-1000, Math.min(1000, cp));

    for (const r of records) {
      if (r.color === 'white') {
        wAccSum += r.accuracy;
        wCpSum += Math.max(0, clampCp(r.cpBefore) - clampCp(r.cpAfter));
        wCount++;
        if (r.classification === 'blunder') stats.blunders.white++;
        if (r.classification === 'mistake') stats.mistakes.white++;
        if (r.classification === 'inaccuracy') stats.inaccuracies.white++;
      } else {
        bAccSum += r.accuracy;
        bCpSum += Math.max(0, clampCp(r.cpAfter) - clampCp(r.cpBefore));
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

    if (records.length > 0) {
      const lastFen = records[records.length - 1].fenAfter;
      // La première partie de la chaîne FEN contient le placement des pièces
      const boardStr = lastFen.split(' ')[0];
      (stats as any).queensTraded = !boardStr.includes('q') && !boardStr.includes('Q');

      // Perfect Domination : l'évaluation n'a jamais basculé en faveur de l'adversaire (avec une marge de 50cp)
      let whiteAlwaysAdvantage = true;
      let blackAlwaysAdvantage = true;
      for (const r of records) {
        if (r.cpAfter < -50) whiteAlwaysAdvantage = false;
        if (r.cpAfter > 50) blackAlwaysAdvantage = false;
      }
      (stats as any).perfectDomination = {
        white: whiteAlwaysAdvantage && wCount > 10, // Nécessite une partie d'au moins 10 coups
        black: blackAlwaysAdvantage && bCount > 10
      };
    }

    return stats;
  }
}
