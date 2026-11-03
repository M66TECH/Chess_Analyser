import { MoveRecord, GameStats } from '../pedagogy/types';
import {
  accuracyFromWinPercent,
  ceilCp,
  gameAccuracy,
} from './LichessAccuracy';

/**
 * Statistiques de partie, alignées sur Lichess.
 *
 * Les formules vivent désormais dans `LichessAccuracy.ts` (portage vérifié de
 * `AccuracyPercent.scala` / `eval.scala`). Cette classe ne fait plus que
 * l'agrégation par joueur.
 */
export class AccuracyScore {
  /**
   * Précision d'un coup à partir du delta de jugement de Lichess (échelle
   * `[-1, +1]` **brute**, cf. `Advice.scala`, sans division par 2).
   *
   * Conversion vers `fromWinPercents` (AccuracyPercent.scala) : les WinPercent
   * valent `50 + 50 × chances`, donc un delta de chances D correspond à une
   * perte de `50 × D` points de pourcentage — et non `100 × D`.
   * Exemple : une perte de 100 cp donne D ≈ 0.182 → 9.1 points → ~67 %.
   *
   * @param winDrop perte de chances sur [-1, +1] (positif = le joueur a perdu)
   */
  public static calculateMoveAccuracy(winDrop: number): number {
    if (winDrop <= 0) return 100;
    const winDiff = winDrop * 50; // points de % (WinPercent)
    return accuracyFromWinPercent(50 + winDiff / 2, 50 - winDiff / 2);
  }

  public static computeGameStats(records: MoveRecord[]): GameStats {
    const stats: GameStats = {
      accuracy: { white: 0, black: 0 },
      acpl: { white: 0, black: 0 },
      blunders: { white: 0, black: 0 },
      mistakes: { white: 0, black: 0 },
      inaccuracies: { white: 0, black: 0 },
    };

    let wAccSum = 0, bAccSum = 0;
    let wCpSum = 0, bCpSum = 0;
    let wCount = 0, bCount = 0;

    for (const r of records) {
      // cpBefore / cpAfter sont stockés du point de vue des Blancs.
      const before = ceilCp(r.cpBefore);
      const after = ceilCp(r.cpAfter);

      if (r.color === 'white') {
        wAccSum += r.accuracy;
        // AccuracyCP.mean : perte plafonnée à 0 par coup.
        wCpSum += Math.max(0, before - after);
        wCount++;
        if (r.classification === 'blunder') stats.blunders.white++;
        if (r.classification === 'mistake') stats.mistakes.white++;
        if (r.classification === 'inaccuracy') stats.inaccuracies.white++;
      } else {
        bAccSum += r.accuracy;
        bCpSum += Math.max(0, after - before);
        bCount++;
        if (r.classification === 'blunder') stats.blunders.black++;
        if (r.classification === 'mistake') stats.mistakes.black++;
        if (r.classification === 'inaccuracy') stats.inaccuracies.black++;
      }
    }

    stats.accuracy.white = wCount > 0 ? Math.round((wAccSum / wCount) * 10) / 10 : 0;
    stats.accuracy.black = bCount > 0 ? Math.round((bAccSum / bCount) * 10) / 10 : 0;

    stats.acpl.white = wCount > 0 ? Math.round(wCpSum / wCount) : 0;
    stats.acpl.black = bCount > 0 ? Math.round(bCpSum / bCount) : 0;

    if (records.length > 0) {
      const lastFen = records[records.length - 1].fenAfter;
      // La première partie de la chaîne FEN contient le placement des pièces
      const boardStr = lastFen.split(' ')[0];
      stats.queensTraded = !boardStr.includes('q') && !boardStr.includes('Q');

      // Domination : l'évaluation n'a jamais basculé en faveur de l'adversaire
      // (marge de 50 cp) ET le camp a effectivement obtenu un avantage net
      // (≥ 100 cp) sur au moins un coup, sur au moins 10 coups joués.
      let whiteAlwaysAdvantage = true;
      let blackAlwaysAdvantage = true;
      let whiteReachedAdvantage = false;
      let blackReachedAdvantage = false;
      for (const r of records) {
        if (r.cpAfter < -50) whiteAlwaysAdvantage = false;
        if (r.cpAfter > 50) blackAlwaysAdvantage = false;
        if (r.cpAfter >= 100) whiteReachedAdvantage = true;
        if (r.cpAfter <= -100) blackReachedAdvantage = true;
      }
      stats.perfectDomination = {
        white: whiteAlwaysAdvantage && whiteReachedAdvantage && wCount > 10,
        black: blackAlwaysAdvantage && blackReachedAdvantage && bCount > 10,
      };
    }

    return stats;
  }

  /**
   * Précision de la partie au sens Lichess (`AccuracyPercent.gameAccuracy`) :
   * pondération par la volatilité + moyenne harmonique. Exposé ici pour que
   * l'UI puisse afficher le même chiffre que lichess.org.
   *
   * @param records coups analysés (évaluations POV Blanc dans cpBefore/cpAfter)
   * @param startColor camp qui avait le trait au premier coup
   */
  public static computeLichessAccuracy(
    records: MoveRecord[],
    startColor: 'white' | 'black' = 'white'
  ): { white: number; black: number } {
    return gameAccuracy(
      records.map(r => r.cpAfter),
      startColor
    );
  }
}
