import { describe, it, expect } from 'vitest';
import { AccuracyScore } from '../analysis/AccuracyScore';
import type { MoveRecord } from '../pedagogy/types';

function record(overrides: Partial<MoveRecord>): MoveRecord {
  return {
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1',
    playedMove: 'e2e4',
    cpBefore: 0,
    cpAfter: 0,
    winProbBefore: 0,
    winProbAfter: 0,
    accuracy: 100,
    classification: 'good',
    moveNumber: 1,
    color: 'white',
    san: 'e4',
    nodeId: 'node_1',
    ...overrides,
  };
}

describe('AccuracyScore', () => {
  describe('calculateMoveAccuracy', () => {
    it('retourne 100 quand aucun avantage n\'est perdu', () => {
      expect(AccuracyScore.calculateMoveAccuracy(0)).toBe(100);
      expect(AccuracyScore.calculateMoveAccuracy(-0.2)).toBe(100);
    });

    it('décroît avec la perte de chances et reste bornée à [0, 100]', () => {
      const light = AccuracyScore.calculateMoveAccuracy(0.1);
      const heavy = AccuracyScore.calculateMoveAccuracy(0.8);
      expect(light).toBeGreaterThan(heavy);
      expect(heavy).toBeGreaterThanOrEqual(0);
      expect(light).toBeLessThanOrEqual(100);
    });
  });

  describe('computeGameStats', () => {
    it('retourne 0% pour une partie vide (et non 100%)', () => {
      const stats = AccuracyScore.computeGameStats([]);
      expect(stats.accuracy.white).toBe(0);
      expect(stats.accuracy.black).toBe(0);
      expect(stats.perfectDomination).toBeUndefined();
      expect(stats.queensTraded).toBeUndefined();
    });

    it('calcule des moyennes par couleur', () => {
      const stats = AccuracyScore.computeGameStats([
        record({ color: 'white', accuracy: 90, cpBefore: 20, cpAfter: 10 }),
        record({ color: 'black', accuracy: 50, cpBefore: 10, cpAfter: 110 }),
      ]);
      expect(stats.accuracy.white).toBe(90);
      expect(stats.accuracy.black).toBe(50);
      expect(stats.acpl.white).toBe(10);
      expect(stats.acpl.black).toBe(100);
    });

    it('compte les gaffes, erreurs et imprécisions par couleur', () => {
      const stats = AccuracyScore.computeGameStats([
        record({ color: 'white', classification: 'blunder' }),
        record({ color: 'white', classification: 'mistake' }),
        record({ color: 'black', classification: 'inaccuracy' }),
      ]);
      expect(stats.blunders.white).toBe(1);
      expect(stats.mistakes.white).toBe(1);
      expect(stats.inaccuracies.black).toBe(1);
    });

    it('détecte un positionnement favorable unilatéral', () => {
      const records: MoveRecord[] = [];
      for (let i = 0; i < 24; i++) {
        records.push(record({
          color: i % 2 === 0 ? 'white' : 'black',
          cpAfter: 100,
          fenAfter: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
        }));
      }
      const stats = AccuracyScore.computeGameStats(records);
      expect(stats.queensTraded).toBe(true);
      expect(stats.perfectDomination?.white).toBe(true);
      // cpAfter est toujours favorable aux Blancs : les Noirs ne dominent jamais
      expect(stats.perfectDomination?.black).toBe(false);
    });

    it('ne déclare pas de domination avec trop peu de coups', () => {
      const records: MoveRecord[] = [];
      for (let i = 0; i < 4; i++) {
        records.push(record({ color: i % 2 === 0 ? 'white' : 'black', cpAfter: 100 }));
      }
      const stats = AccuracyScore.computeGameStats(records);
      expect(stats.perfectDomination?.white).toBe(false);
      expect(stats.perfectDomination?.black).toBe(false);
    });
  });
});
