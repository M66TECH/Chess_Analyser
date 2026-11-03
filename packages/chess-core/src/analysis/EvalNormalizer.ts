import {
  ceilCp,
  winPercentFromCentiPawns,
  winningChances,
  winningChancesRaw,
} from './LichessAccuracy';

/**
 * Normalisation des évaluations Stockfish vers un référentiel commun.
 *
 * ⚠ Toutes les formules vivent dans `LichessAccuracy.ts`, portage vérifié de
 * scalachess (`eval.scala`) et lila (`AccuracyPercent.scala`). Cette classe ne
 * fait que les exposer avec la sémantique attendue par le pipeline.
 *
 * Deux échelles coexistent chez Lichess et ne doivent jamais être confondues :
 * - `winningChances` : [-1, +1]
 * - `winPercent`     : [0, 100] = 50 + 50 × winningChances
 */
export class EvalNormalizer {
  /**
   * Centipions → chances de victoire [-1, +1].
   * Plafond à ±1000 centipions (`Cp.ceiling` de scalachess), pas ±10000.
   */
  public static cpToWinningChances(cp: number): number {
    return winningChances(cp);
  }

  /** Centipions → probabilité de victoire [0, 100] (type WinPercent). */
  public static cpToWinPercent(cp: number): number {
    return winPercentFromCentiPawns(cp);
  }

  /**
   * Mat → équivalent en centipions, du point de vue des Blancs.
   * Lichess (`WinPercent.fromMate`) convertit un mat via `Cp.ceiling` (±1000) :
   * on applique la même valeur extrême plutôt qu'une formule de distance.
   *
   * @param mate score UCI (positif = le camp au trait mate)
   * @param sideToMove camp au trait dans la position évaluée
   */
  public static mateToCp(mate: number, sideToMove: 'white' | 'black' = 'white'): number {
    if (mate === 0) return 0;
    const whiteAdvantage = sideToMove === 'white' ? mate > 0 : mate < 0;
    return whiteAdvantage ? 1000 : -1000;
  }

  /**
   * Score normalisé en centipions, point de vue des Blancs.
   * Un mat est ramené à ±1000 cp, comme `Cp.ceiling` chez Lichess.
   *
   * ⚠ Le cp brut d'une évaluation UCI est en POV du camp au trait : pour un
   * coup des Noirs (ou la position après leur coup), le signe est inversé ici,
   * exactement comme le champ mate. Sans ce signe, tous les records des Noirs
   * étaient du mauvais POV et l'ACPL/comparaison d'avantage étaient fausses.
   */
  public static normalize(
    cp: number | undefined,
    mate: number | undefined,
    sideToMove: 'white' | 'black' = 'white'
  ): number {
    if (typeof mate === 'number') {
      return this.mateToCp(mate, sideToMove);
    }
    const raw = ceilCp(cp ?? 0);
    if (raw === 0) return 0;
    return sideToMove === 'white' ? raw : -raw;
  }

  /**
   * Perte de chances du joueur qui vient de jouer — **delta brutal**, sans
   * division. C'est la formule de jugement de Lichess
   * (`modules/tree/Advice.scala`) :
   *
   *   prevWinningChances = WinPercent.winningChances(prev.cp)   // [-1,+1] brut
   *   delta = (current - prev) pipe (d => color.fold(-d, d))
   *   // seuils : .3 → Blunder, .2 → Mistake, .1 → Inaccuracy
   *
   * ⚠ Ne PAS diviser par 2 : `povDiff` (ui/ceval, avec /2) sert à la
   * navigation et aux puzzles, pas au jugement. Avec la division, un coup
   * perdant 100 cp serait jugé « bon » alors que Lichess le juge « ?! ».
   *
   * La sigmoïde est prise SANS plafond (`winningChancesRaw`), comme le code
   * Scala qui ne plafonne pas non plus avant le jugement.
   *
   * @param cpBefore centipions AVANT le coup, POV Blanc
   * @param cpAfter centipions APRÈS le coup, POV Blanc
   * @param color camp qui a joué
   * @returns perte positive si le joueur a perdu des chances
   */
  public static winningChancesDiff(
    cpBefore: number,
    cpAfter: number,
    color: 'white' | 'black'
  ): number {
    const before = winningChancesRaw(cpBefore);
    const after = winningChancesRaw(cpAfter);
    // color.fold(-d, d) : pour les Blancs, la perte est prev - current.
    return color === 'white' ? before - after : after - before;
  }
}
