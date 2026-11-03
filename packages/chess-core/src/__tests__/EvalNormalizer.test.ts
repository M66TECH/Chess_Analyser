import { describe, it, expect } from 'vitest';
import { EvalNormalizer } from '../analysis/EvalNormalizer';
import {
  cpWinningChances,
  winPercentFromCentiPawns,
} from '../analysis/LichessAccuracy';

/**
 * `EvalNormalizer` doit exposer les formules de Lichess sans les déformer.
 * Chaque valeur de référence est dérivée de `LichessAccuracy` (portage vérifié
 * de scalachess `eval.scala` et lila `AccuracyPercent.scala`).
 */
describe('EvalNormalizer', () => {
  describe('cpToWinningChances', () => {
    it('retourne 0 pour cp=0', () => {
      expect(EvalNormalizer.cpToWinningChances(0)).toBeCloseTo(0, 6);
    });

    it('est identique à la formule Lichess', () => {
      for (const cp of [-800, -300, -50, 0, 50, 300, 800]) {
        expect(EvalNormalizer.cpToWinningChances(cp)).toBeCloseTo(cpWinningChances(cp), 12);
      }
    });

    it('est symétrique', () => {
      expect(EvalNormalizer.cpToWinningChances(200))
        .toBeCloseTo(-EvalNormalizer.cpToWinningChances(-200), 12);
    });

    it('plafonne à ±1000 cp (Cp.ceiling), pas ±10000', () => {
      // +10 pions équivaut donc à +1000 cp : 0.9509, pas 0.9999.
      expect(EvalNormalizer.cpToWinningChances(10_000)).toBeCloseTo(0.9509, 3);
      expect(EvalNormalizer.cpToWinningChances(1000))
        .toBe(EvalNormalizer.cpToWinningChances(10_000));
    });
  });

  describe('cpToWinPercent', () => {
    it('vaut 50 pour une position égale', () => {
      expect(EvalNormalizer.cpToWinPercent(0)).toBe(50);
    });

    it('respecte 50 + 50 × winningChances', () => {
      for (const cp of [-500, 0, 500]) {
        expect(EvalNormalizer.cpToWinPercent(cp))
          .toBeCloseTo(winPercentFromCentiPawns(cp), 12);
      }
    });
  });

  describe('mateToCp / normalize', () => {
    it('ramène un mat à ±1000 cp (Cp.ceiling), comme Lichess', () => {
      expect(EvalNormalizer.mateToCp(3, 'white')).toBe(1000);
      expect(EvalNormalizer.mateToCp(-3, 'white')).toBe(-1000);
      expect(EvalNormalizer.mateToCp(1, 'black')).toBe(-1000);
      expect(EvalNormalizer.mateToCp(-1, 'black')).toBe(1000);
    });

    it('retourne 0 pour mate 0', () => {
      expect(EvalNormalizer.mateToCp(0, 'white')).toBe(0);
    });

    it('normalise un cp en POV Blanc et plafonne à ±1000', () => {
      expect(EvalNormalizer.normalize(150, undefined, 'white')).toBe(150);
      expect(EvalNormalizer.normalize(-150, undefined, 'white')).toBe(-150);
      expect(EvalNormalizer.normalize(50_000, undefined, 'white')).toBe(1000);
    });

    it('inverse le signe du cp pour les Noirs (POV trait → POV Blanc)', () => {
      // Black-POV +150 (Noirs meilleurs d'1.5) = Blancs à -1.5.
      expect(EvalNormalizer.normalize(150, undefined, 'black')).toBe(-150);
      expect(EvalNormalizer.normalize(-150, undefined, 'black')).toBe(150);
    });

    it('privilégie le mat sur le cp', () => {
      expect(EvalNormalizer.normalize(0, 5, 'white')).toBe(1000);
    });

    it('traite un cp absent comme 0', () => {
      expect(EvalNormalizer.normalize(undefined, undefined, 'white')).toBe(0);
    });
  });

  describe('winningChancesDiff (delta brut de Advice.scala, sans /2)', () => {
    it('est le delta brut sur l\'échelle [-1, +1]', () => {
      // Référence : cp 200 → -200 donne un delta de 0.7048 (et non 0.3524,
      // qui serait la valeur povDiff avec /2 — fonction utilisée pour la
      // navigation, PAS pour le jugement).
      const [b, a] = [200, -200];
      const expected = cpWinningChances(b) - cpWinningChances(a);
      expect(EvalNormalizer.winningChancesDiff(b, a, 'white')).toBeCloseTo(expected, 12);
      expect(EvalNormalizer.winningChancesDiff(b, a, 'white')).toBeCloseTo(0.7048, 3);
    });

    it('symétrique entre les camps pour une perte équivalente', () => {
      expect(EvalNormalizer.winningChancesDiff(300, 0, 'white'))
        .toBeCloseTo(EvalNormalizer.winningChancesDiff(-300, 0, 'black'), 12);
    });

    it('est POSITIF quand les Blancs perdent des chances (+200 → -200)', () => {
      expect(EvalNormalizer.winningChancesDiff(200, -200, 'white')).toBeGreaterThan(0);
    });

    it('est POSITIF quand les Noirs perdent des chances (-200 → +200)', () => {
      expect(EvalNormalizer.winningChancesDiff(-200, 200, 'black')).toBeGreaterThan(0);
    });

    it('est NÉGATIF quand les Blancs améliorent (-200 → +200)', () => {
      expect(EvalNormalizer.winningChancesDiff(-200, 200, 'white')).toBeLessThan(0);
    });

    it('est NÉGATIF quand les Noirs améliorent (+200 → -200)', () => {
      expect(EvalNormalizer.winningChancesDiff(200, -200, 'black')).toBeLessThan(0);
    });

    it('vaut ~0 pour un coup neutre', () => {
      expect(Math.abs(EvalNormalizer.winningChancesDiff(0, 0, 'white'))).toBeLessThan(1e-9);
    });

    it('une perte de 100 cp franchit le seuil inaccuracy (0.1821 ≥ 0.1)', () => {
      // Advice.scala juge sur le delta BRUT : 100 cp → 0.1821 → « ?! ».
      const drop = EvalNormalizer.winningChancesDiff(100, 0, 'white');
      expect(drop).toBeGreaterThanOrEqual(0.1);
      expect(drop).toBeCloseTo(0.1821, 3);
    });
  });
});
