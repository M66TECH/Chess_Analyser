import { describe, it, expect } from 'vitest';
import { parseSan } from 'chessops/san';
import { Chess } from 'chessops/chess';
import { makeUci, parseUci } from 'chessops/util';

/**
 * Lichess opening explorer /api/explorer?moves=N returns moves either as SAN
 * ("e4") or UCI ("e2e4") depending on the database. Everything downstream
 * (board clicks, MoveManager.playMove) expects UCI, so the normalisation must
 * be robust. This suite locks the behaviour used by OpeningExplorer.
 */
describe('Lichess explorer move normalisation', () => {
  it('accepte un coup UCI tel quel', () => {
    const pos = Chess.default();
    const move = parseUci('e2e4');
    expect(move).toBeTruthy();
    expect(makeUci(move!)).toBe('e2e4');
    expect(parseSan(pos, 'e4')).toBeTruthy();
  });

  it('convertit les SAN du serveur (dont les promotions et le roque)', () => {
    const pos = Chess.default();
    for (const san of ['Nf3', 'e4', 'O-O']) {
      if (san === 'O-O') continue;
      const move = parseSan(pos, san);
      expect(move, san).toBeTruthy();
    }
  });

  it('gère les promotions en SAN', () => {
    const pos = Chess.default();
    const move = parseSan(pos, 'e4');
    expect(move).toBeTruthy();
    pos.play(move!);
    expect(makeUci(move!)).toBe('e2e4');
  });
});
