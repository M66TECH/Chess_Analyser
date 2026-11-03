/**
 * Formatage des évaluations pour l'affichage, aligné sur Lichess
 * (`ui/lib/src/ceval/util.ts` → `renderEval`).
 *
 * ⚠ Convention : toutes les valeurs sont exprimées **du point de vue des
 * Blancs**. Le pipeline normalise avant d'appeler ces fonctions ; ne pas
 * mélanger avec les valeurs brutes UCI (POV du camp au trait).
 */

/** Plafond d'affichage de Lichess : ±99 pions, pour laisser la place au texte. */
const MAX_DISPLAY_PAWNS = 99;

/**
 * Texte de l'évaluation : `+1.2`, `-0.5`, `M3`, `-M5`.
 *
 * @param cp centipions, POV Blanc
 * @param mate nombre de coups avant mat, POV Blanc (négatif = Noirs matent)
 */
export function formatEval(cp?: number, mate?: number): string {
  if (typeof mate === 'number' && mate !== 0) {
    return `${mate > 0 ? '' : '-'}M${Math.abs(mate)}`;
  }

  if (typeof cp === 'number' && Number.isFinite(cp)) {
    // Même arrondi que `renderEval` de Lichess : Math.round(e/10)/10, et non
    // toFixed qui arrondit de façon bancaire (0.35 → 0.3 au lieu de 0.4).
    const pawns = cp / 100;
    const capped =
      Math.abs(pawns) > MAX_DISPLAY_PAWNS ? Math.sign(pawns) * MAX_DISPLAY_PAWNS : pawns;
    const rounded = Math.round(capped * 10) / 10;
    return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
  }

  return '0.0';
}

/**
 * Part (0..100) attribuée au camp affiché en bas de la barre.
 *
 * @param winProb probabilité de victoire [-1, 1], POV Blanc
 * @param orientation camp affiché en bas
 */
export function evalBarShare(winProb: number, orientation: 'white' | 'black'): number {
  const clamped = Number.isFinite(winProb) ? Math.min(1, Math.max(-1, winProb)) : 0;
  const whiteShare = ((clamped + 1) / 2) * 100;
  return orientation === 'white' ? whiteShare : 100 - whiteShare;
}
