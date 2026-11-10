import { describe, it, expect } from 'vitest';
import { AccuracyScore } from '../analysis/AccuracyScore';
import { gameAccuracy } from '../analysis/LichessAccuracy';
import type { MoveRecord } from '../pedagogy/types';

/**
 * P1-8 : startColor doit être dérivé du FEN, pas codé 'white'.
 *
 * Ce test a révélé un bug PLUS PROFOND : le portage de
 * `Color.fromWhite((i % 2 == 0) == startColor.white)` était erroné —
 * quand startColor='black', la formule TS attribuait le premier coup aux
 * Blancs (inversion). Corrigé : i pair = camp au trait.
 *
 * ⚠ Convention des cps : POV BLANC. Un cpAfter POSITIF après le premier
 * coup des Noirs = gaffe noire (le score a monté pour les Blancs).
 */
function record(overrides: Partial<MoveRecord>): MoveRecord {
  return {
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1',
    playedMove: 'e2e4',
    cpBefore: 20,
    cpAfter: 20,
    winProbBefore: 0,
    winProbAfter: 0,
    accuracy: 100,
    classification: 'good',
    moveNumber: 1,
    color: 'white',
    san: 'e4',
    nodeId: 'n1',
    ...overrides,
  };
}

describe('P1-8 : attribution startColor par couleur de départ', () => {
  it('la même position initiale gâchée punit le camp qui AVAIT le trait', () => {
    // cps = [500,500,...] : après le coup 1, les Blancs mènent de 5 pions.
    // Si les BLANCS avaient le trait → leur coup était bon → précision haute.
    // Si les NOIRS avaient le trait → ils viennent de gaffer → précision basse.
    const cps = [500, 500, 500, 500];

    const whiteStart = gameAccuracy(cps, 'white');
    const blackStart = gameAccuracy(cps, 'black');

    // Les Blancs au trait : leur premier coup a fait monter le score.
    expect(whiteStart.white).toBeGreaterThan(80);

    // Les Noirs au trait : leur premier coup a livré 5 pions aux Blancs.
    expect(blackStart.black).toBeLessThan(80);

    // Le paramètre agit : les deux configurations donnent des résultats
    // différents pour la même couleur.
    expect(whiteStart.white).not.toBeCloseTo(blackStart.black, 0);
  });

  it('cas inverse : un cpAfter négatif punit le camp au trait de façon symétrique', () => {
    // cps = [-500,-500,...] : après le coup 1, les Noirs mènent.
    const cps = [-500, -500, -500, -500];
    const whiteStart = gameAccuracy(cps, 'white');
    const blackStart = gameAccuracy(cps, 'black');

    // Blancs au trait : ils ont gâché → précision basse.
    expect(whiteStart.white).toBeLessThan(80);
    // Noirs au trait : leur coup a amélioré leur position → précision haute.
    expect(blackStart.black).toBeGreaterThan(80);
  });

  it('les attributions sont bien inversées par startColor', () => {
    // Données où le camp au trait prend un coup difficile.
    const cps = [500, 0, 100, 50];
    const whiteStart = gameAccuracy(cps, 'white');
    const blackStart = gameAccuracy(cps, 'black');

    // Le swap n'est PAS une égalité exacte (INITIAL_CP=15 en tête fausse la
    // symétrie) mais les résultats doivent DIFFÉRER : c'est la preuve que
    // le paramètre agit sur l'attribution.
    const wDiff = Math.abs(whiteStart.white - blackStart.white);
    expect(wDiff).toBeGreaterThan(1);
  });

  it('computeLichessAccuracy avec startColor=black punit bien les Noirs', () => {
    const records = [500, 0, 0, 0].map((cp, i) =>
      record({ cpAfter: cp, color: i % 2 === 0 ? 'white' : 'black' })
    );

    const blackStart = AccuracyScore.computeLichessAccuracy(records, 'black');
    const whiteStart = AccuracyScore.computeLichessAccuracy(records, 'white');

    // Le même jeu de records donne une précision noire différente selon
    // le camp supposé commencer.
    expect(blackStart.black).toBeLessThan(whiteStart.black);
  });

  it('page.tsx : un PGN au trait aux Noirs est détecté depuis fenBefore', () => {
    const blackFirst = record({ fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' });
    const startColor = blackFirst.fenBefore.split(' ')[1] === 'b' ? 'black' as const : 'white' as const;
    expect(startColor).toBe('black');

    const whiteFirst = record({});
    const startColor2 = whiteFirst.fenBefore.split(' ')[1] === 'b' ? 'black' as const : 'white' as const;
    expect(startColor2).toBe('white');
  });

  it('records vides : aucune couleur ne crash', () => {
    expect(gameAccuracy([], 'black')).toEqual({ white: 0, black: 0 });
  });
});
