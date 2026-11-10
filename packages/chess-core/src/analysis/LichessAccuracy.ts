/**
 * Accuracy & classification portés depuis Lichess, à l'identique.
 *
 * Sources exactes (vérifiées dans le code source, pas de mémoire) :
 * - scalachess `core/src/main/scala/eval.scala`
 *     `WinPercent.fromCentiPawns(cp) = 50 + 50 * winningChances(cp.ceiled)`
 *     `winningChances(cp) = 2 / (1 + exp(-0.00368208 * cp)) - 1`   (borné ±1)
 *     `Cp.ceiled` plafonne à ±1000
 *     `WinPercent.fromMate` = `fromCentiPawns(±1000)` → toujours extrême
 * - lila `modules/analyse/src/main/AccuracyPercent.scala`
 *     `fromWinPercents(before, after)`
 *     `gameAccuracy(startColor, cps)` (pondération par volatilité + harmonique)
 * - lila `modules/analyse/src/main/AccuracyCP.scala` → `diffsList`, `mean`
 * - lila `ui/lib/src/ceval/winningChances.ts` → version navigateur
 *
 * ⚠ Deux échelles coexistent chez Lichess et ne doivent JAMAIS être confondues :
 *   - `WinningChances` : [-1, +1]  (« 2 / (1 + exp) - 1 »)
 *   - `WinPercent`      : [0, 100] (« 50 + 50 * winningChances »)
 * La formule d'accuracy s'applique à `WinPercent` (donc en points de %), c'est
 * pourquoi une perte de 20 points donne ~41 % d'accuracy et non 100 %.
 *
 * L'IA ne recalcule rien : elle explique ces verdicts (voir ExplanationEngine).
 */

/** Probabilité de victoire, échelle [-1, +1] (type WinningChances de Lichess). */
export type WinningChances = number;

/** Probabilité de victoire, échelle [0, 100] (type WinPercent de Lichess). */
export type WinPercent = number;

/** Évaluation UCI : soit des centipions, soit un mat en N coups. */
export interface LichessEvalScore {
  cp?: number;
  mate?: number;
}

/** `Cp.INITIAL` de scalachess (`Cp(15)`). */
export const INITIAL_CP = 15;

/** `Cp.CEILING` de scalachess. */
export const CP_CEILING = 1000;

/** `Cp.ceiled` : plafonne les centipions à ±1000. */
export const ceilCp = (cp: number): number =>
  cp > CP_CEILING ? CP_CEILING : cp < -CP_CEILING ? -CP_CEILING : cp;

/**
 * `WinPercent.winningChances` : 2 / (1 + exp(-0.00368208 * cp)) - 1, borné ±1,
 * **avec** le plafond `Cp.ceiled` appliqué avant (comportement de
 * `fromCentiPawns`). À utiliser pour la précision.
 */
export const winningChances = (cp: number): WinningChances =>
  Math.min(1, Math.max(-1, 2 / (1 + Math.exp(-0.00368208 * ceilCp(cp))) - 1));

/**
 * La même sigmoïde **sans plafond** — c'est celle qu'utilise le jugement des
 * coups (`modules/tree/Advice.scala` → `WinPercent.winningChances(cp)`, qui
 * prend `cp` tel quel, sans `ceiled`). Au-delà de ±1000 cp les deux diffèrent
 * réellement (0.95 vs 0.9999) : utiliser la version brute pour le jugement,
 * la version plafonnée pour la précision.
 */
export const winningChancesRaw = (cp: number): WinningChances =>
  Math.min(1, Math.max(-1, 2 / (1 + Math.exp(-0.00368208 * cp)) - 1));

/**
 * `WinPercent.fromCentiPawns` : 50 + 50 * winningChances(ceiled), échelle [0, 100].
 */
export const winPercentFromCentiPawns = (cp: number): WinPercent =>
  50 + 50 * winningChances(cp);

/**
 * `WinPercent.fromMate` : `fromCentiPawns(±1000)`. Sur l'échelle WinPercent,
 * un mat donne donc toujours 100 (camp qui mate) ou 0 (camp maté).
 */
export const winPercentFromMate = (mate: number): WinPercent =>
  winPercentFromCentiPawns(mate > 0 ? CP_CEILING : -CP_CEILING);

/**
 * `WinPercent.fromScore` : mat prioritaire, sinon centipions.
 * `mate` est exprimé du point de vue du camp qui mate (positif = il mate).
 */
export const winPercentFromScore = (score: LichessEvalScore): WinPercent =>
  typeof score.mate !== 'undefined'
    ? winPercentFromMate(score.mate)
    : winPercentFromCentiPawns(score.cp ?? 0);

/** Alias conservé pour la lecture navigateur (`winningChances.ts`). */
export const cpWinningChances = winningChances;

/** Chances de victoire [-1, 1] du point de vue d'une couleur. */
export const povChances = (color: 'white' | 'black', ev: LichessEvalScore): WinningChances => {
  const diff = typeof ev.mate !== 'undefined'
    ? (ev.mate > 0 ? 1 : -1) * Math.abs(winningChances(ev.mate > 0 ? CP_CEILING : -CP_CEILING))
    : winningChances(ev.cp ?? 0);
  return color === 'white' ? diff : -diff;
};

/**
 * `povDiff` de `winningChances.ts` : (chances(e1) − chances(e2)) / 2.
 */
export const povDiff = (
  color: 'white' | 'black',
  e1: LichessEvalScore,
  e2: LichessEvalScore
): number => (povChances(color, e1) - povChances(color, e2)) / 2;

/**
 * `AccuracyPercent.fromWinPercents(before, after)` — entrées en [0, 100].
 *
 *   if after >= before → 100
 *   else 103.1668100711649 * exp(-0.04354415386753951 * (before - after))
 *        - 3.166924740191411 + 1        (borné [0, 100])
 *
 * Le `+1` est le « bonus d'incertitude » de Lichess.
 */
export const accuracyFromWinPercent = (before: WinPercent, after: WinPercent): number => {
  if (after >= before) return 100;
  const winDiff = before - after;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) - 3.166924740191411;
  return Math.min(100, Math.max(0, raw + 1));
};

export interface AccuracyResult {
  /** Précision du coup, 0..100 (AccuracyPercent de Lichess). */
  accuracy: number;
  /** Perte de chances en points de % (positif = le joueur a perdu). */
  winDrop: number;
  /** Perte en centipions, plafonnée à 0 par coup (AccuracyCP). */
  centipawnLoss: number;
}

/**
 * Précision d'un coup, du point de vue du joueur — même calcul que
 * `AccuracyPercent.fromEvalsAndPov` pour une paire (avant, après).
 *
 * ⚠ Les deux évaluations doivent être exprimées **du point de vue du joueur
 * qui vient de jouer** (positif = bon pour lui), exactement comme Lichess
 * applique `evals.map(_.invert)` pour les Noirs avant `fromEvalsAndPov`.
 * La fonction ne prend donc pas la couleur : elle n'inverse rien.
 *
 * @param before évaluation AVANT le coup, du point de vue du joueur
 * @param after  évaluation APRÈS le coup, du point de vue du joueur
 */
export const moveAccuracy = (
  before: LichessEvalScore,
  after: LichessEvalScore
): AccuracyResult => {
  const beforeWp = winPercentFromScore(before);
  const afterWp = winPercentFromScore(after);
  const winDrop = beforeWp - afterWp;

  const toPovCp = (ev: LichessEvalScore): number => {
    if (typeof ev.mate !== 'undefined') {
      return ev.mate > 0 ? CP_CEILING : -CP_CEILING;
    }
    return ceilCp(ev.cp ?? 0);
  };

  return {
    accuracy: accuracyFromWinPercent(beforeWp, afterWp),
    winDrop,
    centipawnLoss: Math.max(0, toPovCp(before) - toPovCp(after)),
  };
};

/**
 * `AccuracyCP.diffsList(...).atLeast(0)` puis `Maths.mean` :
 * perte moyenne en centipions, chaque coup plafonné à 0 en bas.
 *
 * @param pairs évaluations successives (point de vue du camp `color`)
 */
export const meanCentipawnLoss = (
  pairs: Array<{ before: number; after: number }>,
  color: 'white' | 'black'
): number => {
  if (pairs.length === 0) return 0;
  const total = pairs.reduce((sum, { before, after }) => {
    const b = ceilCp(color === 'white' ? before : -before);
    const a = ceilCp(color === 'white' ? after : -after);
    return sum + Math.max(0, b - a);
  }, 0);
  return Math.round(total / pairs.length);
};

/** `Maths.standardDeviation` (population). */
const standardDeviation = (values: number[]): number => {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

/** `Maths.harmonicMean`. */
const harmonicMean = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const inverseSum = values.reduce((acc, v) => acc + (v === 0 ? 0 : 1 / v), 0);
  return inverseSum === 0 ? 0 : values.length / inverseSum;
};

const squeeze = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * `AccuracyPercent.gameAccuracy(startColor, cps)` — précision de la partie.
 *
 * Algorithme Lichess :
 *  1. `allWinPercents = (Some(Cp.initial) :: cps).map(WinPercent.fromCentiPawns)`
 *     (la position initiale vaut 0 cp)
 *  2. `windowSize = (cps.size / 10).squeeze(2, 8)`
 *  3. fenêtres glissantes → écart-type des WinPercent → poids `squeeze(0.5, 12)`
 *  4. pour chaque paire consécutive : accuracy pondérée par le poids de la fenêtre
 *  5. par couleur : (moyenne pondérée + moyenne harmonique) / 2
 *
 * @param cps évaluations en centipions, POV Blanc, pour chaque coup (null si inconnue)
 * @param startColor camp qui avait le trait au coup 1
 */
export const gameAccuracy = (
  cps: Array<number | undefined>,
  startColor: 'white' | 'black'
): { white: number; black: number } => {
  // Étape 1 — Lichess ajoute l'évaluation initiale `Cp.initial` (+15 cp) en tête.
  const allWinPercents: Array<WinPercent | undefined> = [INITIAL_CP, ...cps].map(cp =>
    cp === undefined ? undefined : winPercentFromCentiPawns(cp)
  );

  // Étape 2 — taille de fenêtre.
  const windowSize = squeeze(Math.floor(cps.length / 10), 2, 8);

  // Étape 3 — fenêtres : Lichess préfixe (windowSize - 2) copies du début,
  // puis ajoute les fenêtres glissantes complètes.
  const windows: Array<Array<WinPercent | undefined>> = [];
  for (let i = 0; i < Math.max(0, Math.min(windowSize, allWinPercents.length) - 2); i++) {
    windows.push(allWinPercents.slice(0, windowSize));
  }
  for (let i = 0; i + windowSize <= allWinPercents.length; i++) {
    windows.push(allWinPercents.slice(i, i + windowSize));
  }

  const weights: Array<number | undefined> = windows.map(w => {
    // En Scala (`AccuracyPercent.scala#L86-L87`) : `xs.flatten` conserve les
    // valeurs définies et `Maths.standardDeviation` retourne `Some(sd)` dès
    // qu'il y a au moins 2 éléments, puis `.so(_.squeeze(0.5, 12))` borne
    // même un écart-type nul (`sd === 0`) à `0.5`.
    const defined = w.filter((v): v is number => v !== undefined);
    if (defined.length < 2) return undefined;
    const sd = standardDeviation(defined);
    return squeeze(sd, 0.5, 12);
  });

  // Étape 4 — paires consécutives pondérées, par couleur.
  type Sample = { color: 'white' | 'black'; accuracy: number; weight: number };
  const samples: Sample[] = [];

  for (let i = 0; i + 1 < allWinPercents.length; i++) {
    const prev = allWinPercents[i];
    const next = allWinPercents[i + 1];
    const weight = weights[i];
    if (prev === undefined || next === undefined || weight === undefined || weight <= 0) continue;

    // `Color.fromWhite((i % 2 == 0) == startColor.white)` : le premier coup
    // (index pair) appartient au camp qui avait le trait.
    // ⚠ Régression corrigée : l'ancienne forme
    // `(i % 2 === 0) === (startColor === 'white') ? startColor : ...`
    // attribuait le premier coup aux Blancs même quand startColor='black'
    // (portage erroné de la formule Scala, jamais couvert par les tests
    // antérieurs qui n'utilisaient que 'white').
    const colourAtPly: 'white' | 'black' =
      i % 2 === 0 ? startColor : startColor === 'white' ? 'black' : 'white';

    // `color.fold(p, n)` : pour Blanc (before, after), pour Noir (after, before).
    const before = colourAtPly === 'white' ? prev : next;
    const after = colourAtPly === 'white' ? next : prev;

    samples.push({
      color: colourAtPly,
      accuracy: accuracyFromWinPercent(before, after),
      weight,
    });
  }

  // Étape 5 — moyenne pondérée et harmonique, puis moyenne des deux.
  const forColor = (color: 'white' | 'black'): number => {
    const entries = samples.filter(s => s.color === color);
    if (entries.length === 0) return 0;

    const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
    const weightedMean =
      totalWeight > 0
        ? entries.reduce((s, e) => s + e.accuracy * e.weight, 0) / totalWeight
        : entries.reduce((s, e) => s + e.accuracy, 0) / entries.length;

    const harm = harmonicMean(entries.map(e => e.accuracy)) ?? weightedMean;
    return (weightedMean + harm) / 2;
  };

  return { white: forColor('white'), black: forColor('black') };
};

export interface PhaseDivision {
  /** Index de demi-coup (ply) où débute le milieu de jeu (`null` si non atteint). */
  middle: number | null;
  /** Index de demi-coup (ply) où débute la finale (`null` si non atteinte). */
  end: number | null;
}

export interface PhaseAccuracies {
  opening?: { white: number; black: number };
  middlegame?: { white: number; black: number };
  endgame?: { white: number; black: number };
  division: PhaseDivision;
}

/**
 * Découpage de la partie en phases (ouverture / milieu / finale), porté depuis
 * `scalachess` `Divider.scala` :
 * - Milieu de jeu dès qu'il reste ≤ 10 pièces majeures/mineures, ou que la
 *   première rangée est suffisamment développée / mélangée.
 * - Finale dès qu'il reste ≤ 6 pièces majeures/mineures au total (hors rois et pions).
 */
export const dividePhases = (fens: string[]): PhaseDivision => {
  let middle: number | null = null;
  let end: number | null = null;

  for (let ply = 0; ply < fens.length; ply++) {
    const boardPart = fens[ply].split(' ')[0] ?? '';
    const ranks = boardPart.split('/');
    if (ranks.length !== 8) continue;

    let majorsAndMinors = 0;
    for (const ch of boardPart) {
      if ('qrbnQRBN'.includes(ch)) majorsAndMinors++;
    }

    if (middle === null) {
      // Compte les pièces encore sur leur rangée de départ (rangée 8 pour Noirs, 1 pour Blancs)
      const countBackrankPieces = (rankStr: string, isWhiteRank: boolean): number => {
        let count = 0;
        for (const ch of rankStr) {
          if (isWhiteRank && 'RNBQK'.includes(ch)) count++;
          if (!isWhiteRank && 'rnbqk'.includes(ch)) count++;
        }
        return count;
      };
      const whiteBackrank = countBackrankPieces(ranks[7], true);
      const blackBackrank = countBackrankPieces(ranks[0], false);

      if (majorsAndMinors <= 10 || whiteBackrank < 4 || blackBackrank < 4 || ply >= 14) {
        middle = ply;
      }
    }

    if (middle !== null && end === null && majorsAndMinors <= 6) {
      end = ply;
      break;
    }
  }

  return { middle, end };
};

/**
 * Précision par phase (`AccuracyPercent.phaseAccuracies` de Lichess).
 */
export const phaseAccuracies = (
  cps: Array<number | undefined>,
  fens: string[],
  startColor: 'white' | 'black' = 'white'
): PhaseAccuracies => {
  const division = dividePhases(fens);
  const colorAtPly = (ply: number): 'white' | 'black' =>
    ply % 2 === 0 ? startColor : startColor === 'white' ? 'black' : 'white';

  const openingEnd = division.middle ?? cps.length;
  const middleEnd = division.end ?? cps.length;

  const opening =
    openingEnd >= 2 ? gameAccuracy(cps.slice(0, openingEnd), startColor) : undefined;
  const middlegame =
    division.middle !== null && middleEnd - division.middle >= 2
      ? gameAccuracy(cps.slice(division.middle, middleEnd), colorAtPly(division.middle))
      : undefined;
  const endgame =
    division.end !== null && cps.length - division.end >= 2
      ? gameAccuracy(cps.slice(division.end), colorAtPly(division.end))
      : undefined;

  return { opening, middlegame, endgame, division };
};
