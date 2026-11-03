import { describe, it, expect } from 'vitest';
import { PgnParser } from '../parser/PgnParser';

describe('PgnParser', () => {
  describe('parse', () => {
    it('rejette un PGN vide', () => {
      const result = PgnParser.parse('');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('parse une partie standard en coups UCI', () => {
      const pgn = `[Event "Test"]
[White "A"]
[Black "B"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0`;
      const result = PgnParser.parse(pgn);
      expect(result.success).toBe(true);
      expect(result.headers.Event).toBe('Test');
      expect(result.moves).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6']);
    });

    it('respecte un FEN de départ personnalisé', () => {
      const pgn = `[Event "Test"]
[SetUp "1"]
[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]

1. Rh8+ Kf7 *`;
      const result = PgnParser.parse(pgn);
      expect(result.success).toBe(true);
      expect(result.moves).toHaveLength(2);
      expect(result.moves[0]).toBe('h1h8');
    });

    it('échoue proprement si aucun coup n\'est jouable', () => {
      const result = PgnParser.parse('1. Xyz9 *');
      expect(result.success).toBe(false);
    });
  });

  describe('exportAnnotatedPgn', () => {
    it('retourne une ligne PGN même sans coups', () => {
      const pgn = PgnParser.exportAnnotatedPgn([]);
      expect(pgn).toContain('[Event');
      expect(pgn.trim().endsWith('*')).toBe(true);
    });

    it('inclut le SAN et le glyphique de classification', () => {
      const pgn = PgnParser.exportAnnotatedPgn([
        {
          fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
          playedMove: 'e2e4',
          cpBefore: 20,
          cpAfter: 20,
          winProbBefore: 0,
          winProbAfter: 0,
          accuracy: 100,
          classification: 'blunder',
          moveNumber: 1,
          color: 'white',
          san: 'e4',
          nodeId: 'node_1',
        },
      ]);
      expect(pgn).toContain('1. e4??');
      expect(pgn).toContain('[%eval 0.20]');
      expect(pgn).toContain('Blunder');
    });
  });
});
