import { describe, it, expect } from 'vitest';
import { describeMove, buildDemo, isPieceEnPrise } from '../pedagogy/MoveNarrator';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Notation brute interdite : SAN (« Nf3 », « Bxc6 ») ou UCI (« e2e4 »).
 * Une case seule est autorisée si elle est annoncée (« en f3 »), comme exigé
 * par la consigne : on désigne la case d'arrivée.
 */
const SAN_LIKE = /\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]\b/;
const UCI_LIKE = /\b[a-h][1-8][a-h][1-8][qrbn]?\b/;
const hasRawNotation = (text: string): boolean => SAN_LIKE.test(text) || UCI_LIKE.test(text);

describe('MoveNarrator.describeMove', () => {
  it('décrit un coup de cavalier sans notation', () => {
    const d = describeMove(START, 'g1f3')!;
    expect(d.text).toBe('Le cavalier va en f3.');
    expect(hasRawNotation(d.text)).toBe(false);
    expect(d.from).toBe('g1');
    expect(d.to).toBe('f3');
  });

  it('nomme la pièce capturée pour une prise', () => {
    // 1. e4 d5 2. exd5
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const d = describeMove(fen, 'e4d5')!;
    expect(d.text).toContain('pion');
    expect(d.text).toContain('prend');
    expect(d.captured).toBe('pion');
    expect(hasRawNotation(d.text)).toBe(false);
  });

  it('annonce l\'échec et donne la case du roi', () => {
    // 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7#
    const beforeMate = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const d = describeMove(beforeMate, 'h5f7')!;
    expect(d.checkmate).toBe(true);
    expect(d.text).toContain('Échec et mat');
    expect(d.kingSquare).toBe('e8');
  });

  it('décrit le roque sans dire « O-O »', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const d = describeMove(fen, 'e1g1')!;
    expect(d.text.toLowerCase()).toContain('roqu');
    expect(d.text).not.toContain('O-O');
  });

  it('décrit une promotion', () => {
    const fen = 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1';
    const d = describeMove(fen, 'e7e8q')!;
    expect(d.text).toContain('dame');
    expect(hasRawNotation(d.text)).toBe(false);
  });

  it('retourne null pour un coup illégal', () => {
    expect(describeMove(START, 'e1e8')).toBeNull();
  });
});

describe('MoveNarrator.buildDemo', () => {
  it('produit une étape par demi-coup, en alternant les camps', () => {
    const steps = buildDemo(START, ['e2e4', 'e7e5', 'g1f3', 'b8c6'], 6);
    expect(steps).toHaveLength(4);
    expect(steps[0].caption).toContain('pion');
    expect(steps[1].caption).toContain('pion');
    expect(steps[2].caption).toContain('cavalier');
    // Chaque étape porte sa position et ses cases à surligner.
    for (const s of steps) {
      expect(s.fen.split(' ')).toHaveLength(6);
      expect(s.highlight).toHaveLength(2);
    }
  });

  it('s\'arrête au premier coup illégal', () => {
    const steps = buildDemo(START, ['e2e4', 'e7e5', 'e1e8', 'd2d4']);
    expect(steps).toHaveLength(2);
  });

  it('s\'arrête sur un échec et mat', () => {
    const beforeMate = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const steps = buildDemo(beforeMate, ['h5f7', 'e8f7'], 6);
    expect(steps).toHaveLength(1);
    expect(steps[0].checkmate).toBe(true);
  });

  it('respecte maxPlies', () => {
    const steps = buildDemo(START, ['e2e4', 'e7e5', 'g1f3', 'b8c6'], 2);
    expect(steps).toHaveLength(2);
  });

  it('retourne [] pour un FEN invalide', () => {
    expect(buildDemo('pas un fen', ['e2e4'])).toEqual([]);
  });
});

describe('MoveNarrator.isPieceEnPrise', () => {
  it('détecte une pièce attaquée', () => {
    // Cavalier noir en d5 attaqué par le pion blanc en c4.
    const fen = '4k3/8/8/3n4/2P5/8/8/4K3 w - - 0 1';
    expect(isPieceEnPrise(fen, 'd5')).toBe(true);
  });

  it('ne signale rien pour une pièce défendue', () => {
    const fen = START;
    expect(isPieceEnPrise(fen, 'e2')).toBe(false);
  });
});
