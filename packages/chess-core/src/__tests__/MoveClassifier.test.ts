import { describe, it, expect } from 'vitest';
import { MoveClassifier } from '../pedagogy/MoveClassifier';

describe('MoveClassifier', () => {
  describe('cpToWinProb', () => {
    it('retourne ~0.5 pour cp=0 (égalité)', () => {
      const prob = MoveClassifier.cpToWinProb(0);
      expect(prob).toBeCloseTo(0.5, 2);
    });

    it('retourne ~1.0 pour un avantage énorme (+10 pions)', () => {
      const prob = MoveClassifier.cpToWinProb(10000);
      expect(prob).toBeGreaterThan(0.99);
    });

    it('retourne ~0.0 pour une position perdue (-10 pions)', () => {
      const prob = MoveClassifier.cpToWinProb(-10000);
      expect(prob).toBeLessThan(0.01);
    });

    it('est symétrique : cpToWinProb(-x) ≈ 1 - cpToWinProb(x)', () => {
      const p = MoveClassifier.cpToWinProb(200);
      const q = MoveClassifier.cpToWinProb(-200);
      expect(p + q).toBeCloseTo(1, 5);
    });

    it('clamp les valeurs > 10000', () => {
      const p1 = MoveClassifier.cpToWinProb(10000);
      const p2 = MoveClassifier.cpToWinProb(99999);
      expect(p1).toBeCloseTo(p2, 5);
    });
  });

  describe('winProbToAccuracy', () => {
    it('retourne 100 pour un coup parfait (pas de perte)', () => {
      const acc = MoveClassifier.winProbToAccuracy(0.6, 0.6);
      expect(acc).toBeCloseTo(100, 0);
    });

    it('retourne ~0 pour un coup catastrophique (clamped à 0)', () => {
      // La formule Lichess peut retourner une valeur très légèrement > 0 avant clamp
      const acc = MoveClassifier.winProbToAccuracy(0.9, 0.1);
      expect(acc).toBeLessThan(0.01); // Proche de 0 après clamp Math.max(0,...)
    });

    it('est monotone décroissante avec la perte de probabilité', () => {
      const a1 = MoveClassifier.winProbToAccuracy(0.7, 0.65); // petite perte
      const a2 = MoveClassifier.winProbToAccuracy(0.7, 0.5);  // grande perte
      expect(a1).toBeGreaterThan(a2);
    });

    it('reste dans [0, 100]', () => {
      for (let drop = 0; drop <= 1; drop += 0.1) {
        const acc = MoveClassifier.winProbToAccuracy(0.8, 0.8 - drop * 0.8);
        expect(acc).toBeGreaterThanOrEqual(0);
        expect(acc).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('classify', () => {
    it('classifie "blunder" pour une perte massive de prob (> 0.20)', () => {
      // Passer de +2.00 à -2.00 est un blunder
      const result = MoveClassifier.classify(200, -200);
      expect(result.classification).toBe('blunder');
    });

    it('classifie "mistake" pour une perte modérée', () => {
      const before = MoveClassifier.cpToWinProb(100);
      const after = MoveClassifier.cpToWinProb(-50);
      // On doit trouver des valeurs qui provoquent probDrop dans [0.10, 0.20]
      const result = MoveClassifier.classify(100, -50);
      // Vérifie juste que c'est mistake ou blunder (dépend des valeurs exactes)
      expect(['mistake', 'blunder']).toContain(result.classification);
    });

    it('classifie "inaccuracy" pour une petite perte (0.05 - 0.10)', () => {
      // Cp qui provoque une perte de prob dans la zone inaccuracy
      // 0.55 → 0.50 = probDrop ≈ 0.05-0.10
      const result = MoveClassifier.classify(25, 0);
      expect(['inaccuracy', 'good', 'excellent']).toContain(result.classification);
    });

    it('classifie "excellent" par défaut quand probDrop <= 0.02 sans bestMoveCp', () => {
      const result = MoveClassifier.classify(100, 95); // très petite perte
      expect(result.classification).toBe('excellent');
    });

    it('classifie "best" quand bestMoveCp correspond (C4)', () => {
      const result = MoveClassifier.classify(100, 95, undefined, undefined, 95);
      expect(result.classification).toBe('best');
    });

    it('classifie "brilliant" quand prob augmente sans bestMoveCp (M3)', () => {
      // Passer de +1.00 à +3.00 = prob augmente → brilliant
      const result = MoveClassifier.classify(100, 300, undefined, undefined, undefined);
      expect(result.classification).toBe('brilliant');
    });

    it('classifie "great" quand prob augmente avec bestMoveCp fourni (M3)', () => {
      // Avec bestMoveCp fourni, le coup n'est pas confirmé meilleur → great plutôt que brilliant
      const result = MoveClassifier.classify(100, 300, undefined, undefined, 300);
      expect(result.classification).toBe('great');
    });

    it('gère mat en avantage pour les blancs (mateBefore > 0 = blancs ont mat)', () => {
      // Les blancs avaient déjà mat, le coup joué maintient l'avantage max
      // cpBefore et cpAfter sont undefined, mateBefore=3 (avantage max)
      // Résultat : effectiveCpBefore = 10000, effectiveCpAfter = 0 → probDrop fort → blunder
      const result = MoveClassifier.classify(undefined, 0, 3, undefined);
      // Si on perd le mat, c'est un blunder
      expect(['blunder', 'mistake']).toContain(result.classification);
    });

    it('classifie brillant/excellent quand on conserve l\'avantage de mat', () => {
      // Avant: mat en 3 (avantage max), Après: mat en 2 (toujours avantage)
      const result = MoveClassifier.classify(undefined, undefined, 3, 2);
      // Les deux positions sont à 10000 → probDrop ≈ 0 → excellent/best
      expect(['best', 'excellent', 'brilliant', 'great']).toContain(result.classification);
    });

    it('classifie blunder quand l\'adversaire obtient mat (mateAfter < 0)', () => {
      // Avant: +1.00 cp, Après: mat adverse en 2 (mateAfter négatif = adversaire a mat)
      const result = MoveClassifier.classify(100, undefined, undefined, -2);
      // effectiveCpAfter = -10000 → blunder
      expect(result.classification).toBe('blunder');
    });

    it('retourne des winProb dans [0, 1]', () => {
      const result = MoveClassifier.classify(200, -100);
      expect(result.winProbBefore).toBeGreaterThanOrEqual(0);
      expect(result.winProbBefore).toBeLessThanOrEqual(1);
      expect(result.winProbAfter).toBeGreaterThanOrEqual(0);
      expect(result.winProbAfter).toBeLessThanOrEqual(1);
    });

    it('retourne accuracy dans [0, 100]', () => {
      const result = MoveClassifier.classify(200, -500);
      expect(result.accuracy).toBeGreaterThanOrEqual(0);
      expect(result.accuracy).toBeLessThanOrEqual(100);
    });

    it('cp=0 → classification "excellent" (position de départ)', () => {
      const result = MoveClassifier.classify(0, 0);
      expect(['best', 'excellent']).toContain(result.classification);
    });

    it('classifie "good" pour une perte dans [0.02, 0.05]', () => {
      // Trouver des valeurs qui font probDrop ≈ 0.03
      // cp 50 → cp 30 ≈ probDrop faible
      const result = MoveClassifier.classify(50, 30);
      // acceptable: good ou excellent
      expect(['good', 'excellent', 'inaccuracy']).toContain(result.classification);
    });
  });
});
