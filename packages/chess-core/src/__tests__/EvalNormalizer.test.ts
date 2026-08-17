import { describe, it, expect } from 'vitest';
import { EvalNormalizer } from '../analysis/EvalNormalizer';

describe('EvalNormalizer', () => {
  describe('cpToWinningChances', () => {
    it('retourne ~0 pour cp=0 (égalité)', () => {
      expect(EvalNormalizer.cpToWinningChances(0)).toBeCloseTo(0, 2);
    });

    it('retourne ~1 pour un avantage énorme (+10 pions)', () => {
      expect(EvalNormalizer.cpToWinningChances(10000)).toBeGreaterThan(0.99);
    });

    it('retourne ~-1 pour une position perdue (-10 pions)', () => {
      expect(EvalNormalizer.cpToWinningChances(-10000)).toBeLessThan(-0.99);
    });

    it('est symétrique : cpToWinningChances(-x) ≈ -cpToWinningChances(x)', () => {
      const p = EvalNormalizer.cpToWinningChances(200);
      const q = EvalNormalizer.cpToWinningChances(-200);
      expect(p + q).toBeCloseTo(0, 5);
    });

    it('clamp les valeurs > 10000', () => {
      const p1 = EvalNormalizer.cpToWinningChances(10000);
      const p2 = EvalNormalizer.cpToWinningChances(99999);
      expect(p1).toBeCloseTo(p2, 5);
    });
  });

  describe('normalize / mateToCp (signe selon le trait)', () => {
    it('traite une position à trait aux Blancs : mate positif = avantage Blancs', () => {
      expect(EvalNormalizer.normalize(undefined, 2, 'white')).toBeGreaterThan(0);
    });

    it('traite une position à trait aux Noirs : mate positif = avantage Noirs (négatif pour les Blancs)', () => {
      expect(EvalNormalizer.normalize(undefined, 2, 'black')).toBeLessThan(0);
    });

    it('traite une position à trait aux Noirs : mate négatif (Noirs matés) = avantage Blancs', () => {
      expect(EvalNormalizer.normalize(undefined, -3, 'black')).toBeGreaterThan(0);
    });

    it('retourne cp brut quand pas de mate', () => {
      expect(EvalNormalizer.normalize(-150, undefined, 'black')).toBe(-150);
    });

    it('retourne 0 sans cp ni mate', () => {
      expect(EvalNormalizer.normalize(undefined, undefined)).toBe(0);
    });
  });

  describe('winningChancesDiff (perte de chances du joueur)', () => {
    it('retourne une valeur POSITIVE quand les Blancs jouent une gaffe (+200 -> -200)', () => {
      const drop = EvalNormalizer.winningChancesDiff(200, -200, 'white');
      expect(drop).toBeGreaterThan(0.6);
    });

    it('retourne une valeur POSITIVE quand les Noirs jouent une gaffe (-200 -> +200)', () => {
      const drop = EvalNormalizer.winningChancesDiff(-200, 200, 'black');
      expect(drop).toBeGreaterThan(0.6);
    });

    it('retourne une valeur NÉGATIVE quand les Blancs améliorent (-200 -> +200)', () => {
      const drop = EvalNormalizer.winningChancesDiff(-200, 200, 'white');
      expect(drop).toBeLessThan(-0.6);
    });

    it('retourne une valeur NÉGATIVE quand les Noirs améliorent (+200 -> -200)', () => {
      const drop = EvalNormalizer.winningChancesDiff(200, -200, 'black');
      expect(drop).toBeLessThan(-0.6);
    });

    it('retourne ~0 pour un coup qui ne change rien', () => {
      const drop = EvalNormalizer.winningChancesDiff(0, 0, 'white');
      expect(Math.abs(drop)).toBeLessThan(0.01);
    });
  });
});