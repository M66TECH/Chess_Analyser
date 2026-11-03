import { describe, it, expect } from 'vitest';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { chessgroundDests } from 'chessops/compat';
import { parseUci } from 'chessops/util';

/**
 * Les destinations légales passées à chessground doivent inclure les coups
 * spéciaux. Ces tests verrouillent le comportement observé pour éviter
 * qu'une régression ne rende une promotion ou un roque impossible à jouer.
 */
const fen = (f: string) => Chess.fromSetup(parseFen(f).unwrap()).unwrap();

describe('chessgroundDests — couverture des coups spéciaux', () => {
  // Roi noir en a8 : e8 est libre, la promotion est réellement possible.
  const PROMO = 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1';

  it('expose la case de promotion comme destination', () => {
    const dests = chessgroundDests(fen(PROMO));
    expect(dests.get('e7')).toContain('e8');
  });

  it('la promotion reste légale dans chessops pour les 4 pièces', () => {
    const pos = fen(PROMO);
    for (const uci of ['e7e8q', 'e7e8r', 'e7e8b', 'e7e8n']) {
      const move = parseUci(uci);
      expect(move).toBeTruthy();
      expect(pos.isLegal(move!)).toBe(true);
    }
  });

  it('expose le roque', () => {
    const dests = chessgroundDests(fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'));
    expect(dests.get('e1')).toBeTruthy();
  });

  it('expose l\'en passant', () => {
    const dests = chessgroundDests(fen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2'));
    expect(dests.get('e5')).toContain('d6');
  });
});
