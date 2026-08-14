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
   * Converts a mate score (number of moves to mate) to an equivalent centipawn value.
   * Lichess formula: (21 - min(10, |mate|)) * 100
   * Positive mate means White is mating.
   */
  public static mateToCp(mate: number): number {
    if (mate === 0) return 0;
    const absMate = Math.abs(mate);
    const cp = (21 - Math.min(10, absMate)) * 100;
    return mate > 0 ? cp : -cp;
  }

  /**
   * Returns the normalized CP score (from White's perspective).
   */
  public static normalize(cp: number | undefined, mate: number | undefined): number {
    if (mate !== undefined) {
      return this.mateToCp(mate);
    }
    return cp ?? 0;
  }

  /**
   * Calculates the difference in winning chances between two evaluations,
   * ALWAYS from the perspective of the player who just moved.
   * @param cpBefore CP score BEFORE the move (White's POV)
   * @param cpAfter CP score AFTER the move (White's POV)
   * @param color The color of the player who played the move
   */
  public static winningChancesDiff(cpBefore: number, cpAfter: number, color: 'white' | 'black'): number {
    let diff = this.cpToWinningChances(cpAfter) - this.cpToWinningChances(cpBefore);
    // If black played, an increase in White's POV CP is a negative diff for Black.
    return color === 'white' ? diff : -diff;
  }
}
