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

    it('parseTree extrait correctement les variantes RAV imbriquées', () => {
      const pgn = `1. e4 e5 (1... c5 2. Nf3 (2. Nc3 Nc6)) 2. Nf3 Nc6 *`;
      const result = PgnParser.parseTree(pgn);
      expect(result.success).toBe(true);
      expect(result.mainlineMoves).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
      
      // Doit contenir les coups de la ligne principale ET des variantes
      const sans = Array.from(result.nodes.values()).map(n => n.san);
      expect(sans).toContain('e4');
      expect(sans).toContain('e5');
      expect(sans).toContain('c5');
      expect(sans).toContain('Nc3');
      
      const c5Node = Array.from(result.nodes.values()).find(n => n.san === 'c5');
      expect(c5Node).toBeDefined();
      expect(c5Node?.isMainline).toBe(false);
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

    it('exporte les variantes entre parenthèses selon la norme PGN', () => {
      const pgnInput = `1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *`;
      const treeRes = PgnParser.parseTree(pgnInput);
      expect(treeRes.success).toBe(true);

      const exported = PgnParser.exportAnnotatedPgn([], {
        nodes: treeRes.nodes,
        initialFen: treeRes.initialFen,
      });

      expect(exported).toContain('1. e4');
      expect(exported).toContain('e5');
      expect(exported).toContain('(1... c5 2. Nf3)');
    });
  });

  describe('Notation échiquéenne française (P0.4)', () => {
    it('normalise la notation française en notation internationale', () => {
      const frenchPgn = `[Event "Championnat de France"]
[Site "Paris"]
[White "Joueur Blanc"]
[Black "Joueur Noir"]

1. e4 e5 2. Cf3 Cc6 3. Fb5 a6 4. Fxc6 dxc6 5. O-O Dd6 6. d3 Fe6 7. Te1 O-O-O 8. Fe3 f6 9. Cbd2 g5 *`;

      const result = PgnParser.parse(frenchPgn);
      expect(result.success).toBe(true);
      expect(result.headers.White).toBe('Joueur Blanc');
      expect(result.moves).toHaveLength(18);
      expect(result.moves.slice(0, 4)).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    });

    it('gère les promotions en notation française (=D, =C, =F, =T)', () => {
      const promoPgn = `[SetUp "1"]
[FEN "8/4P3/8/8/8/8/8/k3K3 w - - 0 1"]

1. e8=D *`;
      const result = PgnParser.parse(promoPgn);
      expect(result.success).toBe(true);
      expect(result.moves).toEqual(['e7e8q']);
    });

    it('convertFrenchSanToInternational convertit les pièces individuelles', () => {
      expect(PgnParser.convertFrenchSanToInternational('Cf3')).toBe('Nf3');
      expect(PgnParser.convertFrenchSanToInternational('Fb5+')).toBe('Bb5+');
      expect(PgnParser.convertFrenchSanToInternational('Tad1')).toBe('Rad1');
      expect(PgnParser.convertFrenchSanToInternational('Dxd8#')).toBe('Qxd8#');
      expect(PgnParser.convertFrenchSanToInternational('Re2')).toBe('Ke2');
      expect(PgnParser.convertFrenchSanToInternational('e8=D')).toBe('e8=Q');
    });
  });
});
