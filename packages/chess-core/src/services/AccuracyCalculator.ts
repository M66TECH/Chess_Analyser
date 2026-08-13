import { GameAccuracy, MoveRecord } from '../pedagogy/types';

export class AccuracyCalculator {
  /**
   * Computes overall, white, black accuracy from a move list.
   * Also breaks it down by phase: opening (moves 1-10), middlegame (11-30), endgame (31+).
   */
  public static computeGameAccuracy(moves: MoveRecord[]): GameAccuracy {
    const whiteAccs = moves.filter(m => m.color === 'white').map(m => m.accuracy);
    const blackAccs = moves.filter(m => m.color === 'black').map(m => m.accuracy);
    const openingAccs = moves.filter(m => m.moveNumber <= 10).map(m => m.accuracy);
    const midAccs = moves.filter(m => m.moveNumber > 10 && m.moveNumber <= 30).map(m => m.accuracy);
    const endAccs = moves.filter(m => m.moveNumber > 30).map(m => m.accuracy);

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const overall = avg([...whiteAccs, ...blackAccs]);

    return {
      overall: Math.round(overall * 10) / 10,
      white: Math.round(avg(whiteAccs) * 10) / 10,
      black: Math.round(avg(blackAccs) * 10) / 10,
      opening: Math.round(avg(openingAccs) * 10) / 10,
      middlegame: Math.round(avg(midAccs) * 10) / 10,
      endgame: Math.round(avg(endAccs) * 10) / 10,
    };
  }

  /**
   * Returns a human-readable label for an accuracy value.
   */
  public static getLabel(accuracy: number): string {
    if (accuracy >= 98) return 'Parfait';
    if (accuracy >= 90) return 'Excellent';
    if (accuracy >= 75) return 'Très bon';
    if (accuracy >= 60) return 'Bon';
    if (accuracy >= 45) return 'Moyen';
    if (accuracy >= 30) return 'Faible';
    return 'Très faible';
  }
}
