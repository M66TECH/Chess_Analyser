import { describe, it, expect } from 'vitest';
import { OpeningBook } from '../explorer/OpeningBook';
import type { OpeningData } from '../explorer/ExplorerCache';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

/** Shape of the masters endpoint: SAN + UCI + per-move opening. */
function mastersData(): OpeningData {
  return {
    white: 933863,
    draws: 1271743,
    black: 673981,
    moves: [
      { uci: 'e2e4', san: 'e4', white: 419328, draws: 573290, black: 316848, averageRating: 2396 },
      { uci: 'd2d4', san: 'd4', white: 334470, draws: 461840, black: 233568, averageRating: 2409 },
      { uci: 'g1f3', san: 'Nf3', white: 58000, draws: 71000, black: 40000, averageRating: 2390 },
    ],
  };
}

/** Older responses only carry SAN. */
function sanOnlyData(): OpeningData {
  return {
    white: 10,
    draws: 10,
    black: 10,
    moves: [
      { uci: '', san: 'e4', white: 100, draws: 100, black: 80 },
      { uci: '', san: 'd4', white: 60, draws: 60, black: 50 },
    ],
  };
}

describe('OpeningBook', () => {
  describe('resolveMoves', () => {
    it('accepte les coups UCI tels quels', () => {
      const moves = OpeningBook.resolveMoves(START, mastersData());
      expect(moves.map(m => m.uci)).toEqual(['e2e4', 'd2d4', 'g1f3']);
      expect(moves[2].san).toBe('Nf3');
    });

    it('convertit les réponses SAN-only en UCI', () => {
      const moves = OpeningBook.resolveMoves(START, sanOnlyData());
      expect(moves.map(m => m.uci)).toEqual(['e2e4', 'd2d4']);
    });

    it('ignore une position illisible ou une réponse vide', () => {
      expect(OpeningBook.resolveMoves('fen invalide', mastersData())).toEqual([]);
      expect(OpeningBook.resolveMoves(START, null)).toEqual([]);
    });
  });

  describe('rank', () => {
    it('classe les coups par fréquence', () => {
      const ranked = OpeningBook.rank(START, mastersData(), 'white');
      expect(ranked[0].uci).toBe('e2e4');
      expect(ranked[0].games).toBeGreaterThan(0);
      expect(ranked[0].frequency).toBeGreaterThan(ranked[2].frequency);
      // 4.e2e4 scores well for White in the masters database
      expect(ranked[0].score).toBeGreaterThan(0.5);
    });

    it('privilégie un coup à la fois populaire et performant', () => {
      const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      const data: OpeningData = {
        white: 100,
        draws: 0,
        black: 100,
        moves: [
          // Most played but losing for White
          { uci: 'e2e4', san: 'e4', white: 10, draws: 0, black: 50 },
          // Nearly as popular and winning for White
          { uci: 'd2d4', san: 'd4', white: 45, draws: 0, black: 5 },
        ],
      };
      const ranked = OpeningBook.rank(fen, data, 'white');
      expect(ranked[0].uci).toBe('d2d4');
    });

    it('ignore les coups trop rares pour être de la théorie', () => {
      const data: OpeningData = {
        white: 1000,
        draws: 0,
        black: 1000,
        moves: [
          { uci: 'e2e4', san: 'e4', white: 700, draws: 0, black: 500 },
          { uci: 'a2a3', san: 'a3', white: 2, draws: 0, black: 1 },
        ],
      };
      const ranked = OpeningBook.rank(START, data, 'white');
      expect(ranked.map(m => m.uci)).toEqual(['e2e4']);
    });

    it('inverse le score pour les Noirs', () => {
      const data: OpeningData = {
        white: 100,
        draws: 0,
        black: 100,
        moves: [
          { uci: 'e7e5', san: 'e5', white: 40, draws: 0, black: 60 },
          { uci: 'c7c5', san: 'c5', white: 20, draws: 0, black: 40 },
        ],
      };
      const ranked = OpeningBook.rank(AFTER_E4, data, 'black');
      expect(ranked[0].score).toBeGreaterThan(0.5);
    });
  });

  describe('isTheoryMove / bestTheoryMove', () => {
    it('reconnaît un coup de théorie', () => {
      expect(OpeningBook.isTheoryMove(START, mastersData(), 'e2e4')).toBe(true);
      expect(OpeningBook.isTheoryMove(START, mastersData(), 'h2h3')).toBe(false);
    });

    it('retourne le meilleur coup de théorie', () => {
      expect(OpeningBook.bestTheoryMove(START, mastersData())?.uci).toBe('e2e4');
    });

    it('retourne null hors base', () => {
      expect(OpeningBook.bestTheoryMove(START, null)).toBeNull();
      expect(OpeningBook.bestTheoryMove(START, { white: 0, draws: 0, black: 0, moves: [] })).toBeNull();
    });
  });
});
