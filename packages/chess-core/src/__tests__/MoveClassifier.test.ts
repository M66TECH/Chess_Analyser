import { describe, it, expect } from 'vitest';
import { MoveClassifier } from '../pedagogy/MoveClassifier';

describe('MoveClassifier', () => {
  describe('classify (perte de chances = winDrop positif)', () => {
    it('classifie "blunder" pour une perte massive (>= 0.3)', () => {
      const result = MoveClassifier.classify(0.3);
      expect(result.classification).toBe('blunder');
    });

    it('classifie "mistake" pour une perte modérée (>= 0.2)', () => {
      const result = MoveClassifier.classify(0.2);
      expect(result.classification).toBe('mistake');
    });

    it('classifie "inaccuracy" pour une perte légère (>= 0.1)', () => {
      const result = MoveClassifier.classify(0.1);
      expect(result.classification).toBe('inaccuracy');
    });

    it('classifie "good" pour une faible perte dans ]0.02, 0.1[', () => {
      const result = MoveClassifier.classify(0.05);
      expect(result.classification).toBe('good');
    });

    it('classifie "good" pour un coup neutre qui n\'est pas le meilleur', () => {
      expect(MoveClassifier.classify(0).classification).toBe('good');
      expect(MoveClassifier.classify(-0.02).classification).toBe('good');
    });

    it('classifie "best" pour un coup neutre qui est le meilleur', () => {
      expect(MoveClassifier.classify(0, true).classification).toBe('best');
    });
  });

  describe('classify (amélioration = winDrop négatif)', () => {
    it('classifie "brilliant" pour une grosse amélioration qui n\'est PAS le meilleur coup', () => {
      const result = MoveClassifier.classify(-0.15);
      expect(result.classification).toBe('brilliant');
    });

    it('classifie "best" pour une grosse amélioration qui EST le meilleur coup', () => {
      const result = MoveClassifier.classify(-0.15, true);
      expect(result.classification).toBe('best');
    });

    it('classifie "great" pour une amélioration modérée non meilleure (<= -0.05)', () => {
      const result = MoveClassifier.classify(-0.05);
      expect(result.classification).toBe('great');
    });

    it('classifie "best" pour une amélioration modérée qui est le meilleur coup', () => {
      const result = MoveClassifier.classify(-0.05, true);
      expect(result.classification).toBe('best');
    });
  });

  describe('accuracy', () => {
    it('retourne 100 pour un coup parfait ou une amélioration', () => {
      expect(MoveClassifier.classify(0).accuracy).toBe(100);
      expect(MoveClassifier.classify(-0.3).accuracy).toBe(100);
    });

    it('décroit avec la perte de chances', () => {
      const smallLoss = MoveClassifier.classify(0.1).accuracy;
      const bigLoss = MoveClassifier.classify(0.5).accuracy;
      expect(smallLoss).toBeGreaterThan(bigLoss);
      expect(smallLoss).toBeLessThan(100);
    });

    it('reste dans [0, 100]', () => {
      for (let drop = 0; drop <= 1; drop += 0.1) {
        const acc = MoveClassifier.classify(drop).accuracy;
        expect(acc).toBeGreaterThanOrEqual(0);
        expect(acc).toBeLessThanOrEqual(100);
      }
    });
  });
});