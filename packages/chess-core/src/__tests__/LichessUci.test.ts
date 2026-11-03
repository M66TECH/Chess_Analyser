import { describe, it, expect } from 'vitest';
import {
  parseUciInfo,
  parseBestMove,
  UCI_INIT_COMMANDS,
  UCI_ENGINE_OPTIONS,
} from '../engine/LichessUci';

/**
 * Le parsing UCI est calqué sur `lila/ui/lib/src/ceval/protocol.ts`.
 * Ces tests verrouillent les cas limites que Stockfish émet réellement.
 */
describe('LichessUci', () => {
  describe('parseUciInfo', () => {
    it('extrait depth, cp, multipv et pv', () => {
      const info = parseUciInfo('info depth 18 seldepth 24 multipv 1 score cp 34 nodes 1200 pv e2e4 e7e5');
      expect(info).not.toBeNull();
      expect(info!.depth).toBe(18);
      expect(info!.cp).toBe(34);
      expect(info!.mate).toBeUndefined();
      expect(info!.multipv).toBe(1);
      expect(info!.pv).toEqual(['e2e4', 'e7e5']);
      expect(info!.nodes).toBe(1200);
    });

    it('extrait un mat', () => {
      const info = parseUciInfo('info depth 12 score mate 3 pv d8h4 g6h4');
      expect(info!.mate).toBe(3);
      expect(info!.cp).toBeUndefined();
    });

    it('gère un mat négatif', () => {
      const info = parseUciInfo('info depth 20 score mate -5 pv e2e4');
      expect(info!.mate).toBe(-5);
    });

    it('rejette "mate 0" (Lichess: "Sometimes we get #0. Let\'s just skip it")', () => {
      expect(parseUciInfo('info depth 10 score mate 0 pv e2e4')).toBeNull();
    });

    it('capture les bornes lowerbound / upperbound', () => {
      const lower = parseUciInfo('info depth 5 score cp 20 lowerbound pv e2e4');
      const upper = parseUciInfo('info depth 5 score cp -20 upperbound pv e2e4');
      expect(lower!.bound).toBe('lower');
      expect(upper!.bound).toBe('upper');
    });

    it('multipv par défaut = 1', () => {
      const info = parseUciInfo('info depth 8 score cp 10 pv e2e4');
      expect(info!.multipv).toBe(1);
    });

    it('lit correctement multipv 2 et 3', () => {
      expect(parseUciInfo('info depth 8 multipv 2 score cp 5 pv d2d4')!.multipv).toBe(2);
      expect(parseUciInfo('info depth 8 multipv 3 score cp -5 pv c2c4')!.multipv).toBe(3);
    });

    it('ignore les lignes sans score exploitables', () => {
      expect(parseUciInfo('info depth 5 currmove e2e4 currmovenumber 1')).toBeNull();
      expect(parseUciInfo('info string NNUE evaluation using nn-abc.nnue')).toBeNull();
      expect(parseUciInfo('info depth 5 score cp 10 pv e2e4')?.cp).toBe(10);
    });

    it('retourne null hors des lignes info', () => {
      expect(parseUciInfo('bestmove e2e4')).toBeNull();
      expect(parseUciInfo('uciok')).toBeNull();
      expect(parseUciInfo('')).toBeNull();
    });

    it('conserve une PV vide si absente', () => {
      const info = parseUciInfo('info depth 3 score cp 0');
      expect(info!.pv).toEqual([]);
    });

    it('tolère les espaces multiples', () => {
      const info = parseUciInfo('info   depth   9    score   cp   12    pv   e2e4');
      expect(info!.depth).toBe(9);
      expect(info!.cp).toBe(12);
      expect(info!.pv).toEqual(['e2e4']);
    });
  });

  describe('parseBestMove', () => {
    it('extrait le meilleur coup', () => {
      expect(parseBestMove('bestmove e2e4')).toEqual({ bestMove: 'e2e4', ponder: undefined });
    });

    it('extrait le ponder', () => {
      expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ bestMove: 'e2e4', ponder: 'e7e5' });
    });

    it('retourne null pour "(none)" (aucun coup légal)', () => {
      expect(parseBestMove('bestmove (none)')).toBeNull();
    });

    it('retourne null hors ligne bestmove', () => {
      expect(parseBestMove('info depth 3')).toBeNull();
      expect(parseBestMove('bestmove')).toBeNull();
    });

    it('accepte une promotion en UCI', () => {
      expect(parseBestMove('bestmove e7e8q')?.bestMove).toBe('e7e8q');
    });
  });

  describe('constantes', () => {
    it('expose les commandes d\'initialisation Lichess (sans Chess960)', () => {
      expect(UCI_INIT_COMMANDS).toContain('setoption name UCI_AnalyseMode value true');
      expect(UCI_INIT_COMMANDS).toContain('setoption name Analysis Contempt value Off');
      // Chess960 casserait l'encodage du roque en UCI (e1h1 au lieu de e1g1).
      expect(UCI_INIT_COMMANDS.some(c => c.includes('Chess960'))).toBe(false);
    });

    it('expose des options de moteur valides', () => {
      expect(UCI_ENGINE_OPTIONS.threads).toBeGreaterThan(0);
      expect(UCI_ENGINE_OPTIONS.hash).toBeGreaterThanOrEqual(16);
      expect(UCI_ENGINE_OPTIONS.multiPv).toBeGreaterThanOrEqual(1);
    });
  });
});
