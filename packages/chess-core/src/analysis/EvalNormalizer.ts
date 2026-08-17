/**
 * Normalizes engine evaluations according to Lichess formulas.
 */
export class EvalNormalizer {
  /**
   * Converts centipawns to winning chances [-1, 1].
   * Formula from Lichess: 2 / (1 + Math.exp(-0.00368208 * cp)) - 1
   */
  public static cpToWinningChances(cp: number): number {
    const clamped = Math.max(-10000, Math.min(10000, cp));
    return 2 / (1 + Math.exp(-0.00368208 * clamped)) - 1;
  }

  /**
   * Converts a mate score (number of moves to mate) to an equivalent centipawn value
   * expressed from White's perspective.
   * Lichess formula: (21 - min(10, |mate|)) * 100
   * UCI convention: `score mate +N` means the side to move delivers mate in N moves.
   * @param mate Mate score from the side-to-move's perspective (positive = that side mates)
   * @param sideToMove The color that is to move in the analyzed position
   */
  public static mateToCp(mate: number, sideToMove: 'white' | 'black'): number {
    if (mate === 0) return 0;
    const absMate = Math.abs(mate);
    const cp = (21 - Math.min(10, absMate)) * 100;
    const whiteAdvantage = sideToMove === 'white' ? mate > 0 : mate < 0;
    return whiteAdvantage ? cp : -cp;
  }

  /**
   * Returns the normalized CP score (from White's perspective).
   * @param sideToMove The color that is to move in the position this eval belongs to
   */
  public static normalize(cp: number | undefined, mate: number | undefined, sideToMove: 'white' | 'black' = 'white'): number {
    if (mate !== undefined) {
      return this.mateToCp(mate, sideToMove);
    }
    return cp ?? 0;
  }

  /**
   * Calculates the winning chances DROPPED by the player who just moved.
   * Positive = the player LOST winning chances (bad move), negative = gained (good move).
   * @param cpBefore CP score BEFORE the move (White's POV)
   * @param cpAfter CP score AFTER the move (White's POV)
   * @param color The color of the player who played the move
   */
  public static winningChancesDiff(cpBefore: number, cpAfter: number, color: 'white' | 'black'): number {
    const whiteBefore = this.cpToWinningChances(cpBefore);
    const whiteAfter = this.cpToWinningChances(cpAfter);
    // For White: drop = chances before − chances after.
    // For Black: Black's chances are the mirror of White's (whiteAfter − whiteBefore is Black's drop).
    return color === 'white' ? whiteBefore - whiteAfter : whiteAfter - whiteBefore;
  }
}
