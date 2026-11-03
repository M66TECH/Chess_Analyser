import { describe, it, expect } from 'vitest';
import { MotifEngine } from '../pedagogy/MotifEngine';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { type Board } from 'chessops/board';

function boardFromFen(fen: string): Board {
  const parsed = parseFen(fen).unwrap();
  const pos = Chess.fromSetup(parsed).unwrap();
  return pos.board;
}

describe('MotifEngine', () => {
  describe('detectPins', () => {
    it('détecte un clouage absolu (Tour -> Cavalier -> Roi)', () => {
      const board = boardFromFen('4k3/8/8/4n3/8/8/8/4R1K1 w - - 0 1');
      const pins = MotifEngine.detectPins(board);
      expect(pins.length).toBeGreaterThan(0);
    });

    it('ne détecte pas de clouage dans la position initiale', () => {
      const board = boardFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      expect(MotifEngine.detectPins(board)).toHaveLength(0);
    });
  });

  describe('detectUndefended', () => {
    it('détecte un cavalier noir sans défense attaqué par un pion', () => {
      const board = boardFromFen('7k/8/8/4n3/3P4/8/8/7K w - - 0 1');
      const undefended = MotifEngine.detectUndefended(board, undefined);
      const hasKnight = undefended.some(u => {
        const file = String.fromCharCode(97 + (u.square % 8));
        const rank = Math.floor(u.square / 8) + 1;
        return `${file}${rank}` === 'e5';
      });
      expect(hasKnight).toBe(true);
    });

    it('ne détecte pas de pièce en prise dans la position initiale', () => {
      const board = boardFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      expect(MotifEngine.detectUndefended(board, undefined)).toHaveLength(0);
    });

    it('détecte un pion prenable en passant mais protégé directement (conformité boardAnalysis.test.ts)', () => {
      const parsed = parseFen('6bk/8/8/3pPp2/8/8/6B1/6K1 w - d6 0 1').unwrap();
      const undefended = MotifEngine.detectUndefended(parsed.board, parsed.epSquare);
      const squares = undefended.map(u => {
        const file = String.fromCharCode(97 + (u.square % 8));
        const rank = Math.floor(u.square / 8) + 1;
        return `${file}${rank}`;
      });
      expect(squares).toEqual(['d6']);
    });

    it('ne marque pas comme non défendue une pièce dont le défenseur n\'est pas réellement éliminé (Attacker also pins defender)', () => {
      const parsed = parseFen('6k1/8/8/8/1q6/2B5/1P6/4K3 b - - 0 1').unwrap();
      const undefended = MotifEngine.detectUndefended(parsed.board, parsed.epSquare);
      const squares = undefended.map(u => {
        const file = String.fromCharCode(97 + (u.square % 8));
        const rank = Math.floor(u.square / 8) + 1;
        return `${file}${rank}`;
      });
      // b4 est en prise (Fou c3), mais b2 ne l'est pas
      expect(squares).toEqual(['b4']);
    });
  });

  describe('detectPositionalFeatures', () => {
    it('identifie les pions doublés, isolés et passés', () => {
      // Blancs ont deux pions doublés isolés sur la colonne c (c3, c4) et un pion passé en a5
      const board = boardFromFen('4k3/8/8/P7/2P5/2P5/8/4K3 w - - 0 1');
      const pos = MotifEngine.detectPositionalFeatures(board);
      expect(pos.doubledPawns.white).toEqual(['c3', 'c4']);
      expect(pos.isolatedPawns.white).toContain('a5');
      expect(pos.isolatedPawns.white).toContain('c3');
      expect(pos.passedPawns.white).toContain('a5');
    });
  });
});