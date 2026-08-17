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
  });
});