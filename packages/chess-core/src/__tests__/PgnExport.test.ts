import { describe, it, expect } from 'vitest';
import { PgnParser } from '../parser/PgnParser';
import { parsePgn } from 'chessops/pgn';
import type { MoveRecord } from '../pedagogy/types';

/**
 * Export PGN annoté. Régression visée :
 * - `[%eval #0]` était produit pour un mat (notation PGN invalide) ;
 * - le repli de ligne à 70 caractères pouvait couper AU MILIEU d'un
 *   commentaire `{ … }`, ce qui corrompt le PGN.
 */
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function rec(overrides: Partial<MoveRecord> = {}): MoveRecord {
  return {
    fenBefore: START,
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    playedMove: 'e2e4',
    cpBefore: 20,
    cpAfter: 20,
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

describe('PgnParser.exportAnnotatedPgn', () => {
  it('exporte une partie vide sans planter', () => {
    const pgn = PgnParser.exportAnnotatedPgn([]);
    expect(pgn).toContain('[Event');
    expect(pgn.trimEnd().endsWith('*')).toBe(true);
  });

  it('un PGN produit est re-parsable par chessops', () => {
    const pgn = PgnParser.exportAnnotatedPgn([
      rec(),
      rec({ color: 'black', san: 'e5', playedMove: 'e7e5', moveNumber: 1, nodeId: 'n2' }),
      rec({ color: 'white', san: 'Nf3', playedMove: 'g1f3', moveNumber: 2, nodeId: 'n3' }),
    ]);
    const games = parsePgn(pgn);
    expect(games).toHaveLength(1);
    expect(games[0].moves.children.length).toBeGreaterThan(0);
  });

  it('n\'écrit jamais #[%eval #0] pour un mat', () => {
    const pgn = PgnParser.exportAnnotatedPgn([
      rec({ san: 'Qh4#', playedMove: 'd8h4', mateAfter: 0, cpAfter: 1000 }),
    ]);
    expect(pgn).not.toContain('#0');
  });

  it('exporte les mats avec un signe correct en POV Blanc', () => {
    // Les Blancs matent : mateAfter = -2 (le trait après le coup est aux Noirs).
    const pgn = PgnParser.exportAnnotatedPgn([
      rec({ san: 'Qh7#', mateAfter: -1, cpAfter: 1000, classification: 'best' }),
    ]);
    expect(pgn).toContain('[%eval #1]');
  });

  it('ne coupe jamais un commentaire au milieu d\'une ligne', () => {
    const longRecords = Array.from({ length: 30 }, (_, i) =>
      rec({
        san: `Nf${i % 7 + 1}`,
        classification: 'blunder',
        bestMove: 'e2e4',
        playedMove: 'g1f3',
        moveNumber: Math.floor(i / 2) + 1,
        color: i % 2 === 0 ? 'white' : 'black',
        nodeId: `n${i}`,
      })
    );
    const pgn = PgnParser.exportAnnotatedPgn(longRecords);

    // Chaque `{` doit être refermé sur la MÊME ligne que son `}`.
    for (const line of pgn.split('\n')) {
      const open = (line.match(/\{/g) ?? []).length;
      const close = (line.match(/\}/g) ?? []).length;
      expect(open, `ligne non équilibrée: ${line}`).toBe(close);
    }
  });

  it('ajoute SetUp/FEN pour une position de départ personnalisée', () => {
    const customFen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const pgn = PgnParser.exportAnnotatedPgn([
      rec({ fenBefore: customFen, san: 'Kd2', playedMove: 'e1d2' }),
    ]);
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${customFen}"]`);
  });

  it('n\'ajoute pas SetUp/FEN depuis la position standard', () => {
    const pgn = PgnParser.exportAnnotatedPgn([rec()]);
    expect(pgn).not.toContain('[SetUp');
  });
});
