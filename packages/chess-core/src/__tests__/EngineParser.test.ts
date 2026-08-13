import { describe, it, expect } from 'vitest';
import { EngineParser } from '../engine/EngineParser';

describe('EngineParser', () => {
  describe('parseUciInfo', () => {
    it('parse une ligne cp simple', () => {
      const result = EngineParser.parseUciInfo('info depth 1 score cp 100 pv e2e4');
      expect(result).not.toBeNull();
      expect(result!.depth).toBe(1);
      expect(result!.cp).toBe(100);
      expect(result!.pv).toEqual(['e2e4']);
    });

    it('parse un score négatif', () => {
      const result = EngineParser.parseUciInfo('info depth 5 score cp -250 pv d7d5 e2e4');
      expect(result!.cp).toBe(-250);
      expect(result!.pv).toEqual(['d7d5', 'e2e4']);
    });

    it('parse un score de mat positif', () => {
      const result = EngineParser.parseUciInfo('info depth 3 score mate 2 pv e2e4');
      expect(result!.mate).toBe(2);
      expect(result!.cp).toBeUndefined();
    });

    it('parse un score de mat négatif (mat reçu)', () => {
      const result = EngineParser.parseUciInfo('info depth 3 score mate -3 pv d7d5');
      expect(result!.mate).toBe(-3);
    });

    it('retourne null sur une ligne sans info', () => {
      expect(EngineParser.parseUciInfo('uciok')).toBeNull();
      expect(EngineParser.parseUciInfo('readyok')).toBeNull();
      expect(EngineParser.parseUciInfo('')).toBeNull();
    });

    it('retourne null sur une ligne info sans score', () => {
      expect(EngineParser.parseUciInfo('info depth 5 nodes 10000')).toBeNull();
    });

    it('ignore les lignes upperbound (M5)', () => {
      const result = EngineParser.parseUciInfo('info depth 10 score upperbound 500 pv e2e4');
      expect(result).toBeNull();
    });

    it('ignore les lignes lowerbound (M5)', () => {
      const result = EngineParser.parseUciInfo('info depth 10 score lowerbound -500 pv e2e4');
      expect(result).toBeNull();
    });

    it('parse multipv correctement', () => {
      const result = EngineParser.parseUciInfo('info depth 5 multipv 2 score cp 50 pv d2d4');
      expect(result!.multiPv).toBe(2);
    });

    it('multipv NaN traité comme 1 (M4)', () => {
      const result = EngineParser.parseUciInfo('info depth 5 multipv abc score cp 50 pv d2d4');
      expect(result!.multiPv).toBe(1);
    });

    it('retourne null si depth est NaN', () => {
      const result = EngineParser.parseUciInfo('info depth abc score cp 100 pv e2e4');
      expect(result).toBeNull();
    });

    it('retourne null si scoreValue est NaN', () => {
      const result = EngineParser.parseUciInfo('info depth 5 score cp xyz pv e2e4');
      expect(result).toBeNull();
    });

    it('PV peut être vide', () => {
      const result = EngineParser.parseUciInfo('info depth 1 score cp 10');
      expect(result!.pv).toEqual([]);
    });

    it('parse une longue PV', () => {
      const result = EngineParser.parseUciInfo('info depth 14 score cp 30 pv e2e4 e7e5 g1f3 b8c6 f1b5 a7a6');
      expect(result!.pv).toHaveLength(6);
      expect(result!.pv[0]).toBe('e2e4');
    });

    it('profondeur correctement parsée', () => {
      const result = EngineParser.parseUciInfo('info depth 14 score cp 0 pv e2e4');
      expect(result!.depth).toBe(14);
    });
  });

  describe('parseBestMove', () => {
    it('parse un bestmove simple', () => {
      expect(EngineParser.parseBestMove('bestmove e2e4')).toBe('e2e4');
    });

    it('parse bestmove avec ponder', () => {
      expect(EngineParser.parseBestMove('bestmove e2e4 ponder e7e5')).toBe('e2e4');
    });

    it('retourne null pour "(none)" (mat ou pat)', () => {
      expect(EngineParser.parseBestMove('bestmove (none)')).toBeNull();
    });

    it('retourne null pour une ligne qui ne commence pas par bestmove', () => {
      expect(EngineParser.parseBestMove('info depth 5 score cp 10')).toBeNull();
      expect(EngineParser.parseBestMove('')).toBeNull();
    });
  });
});
