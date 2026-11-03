import { describe, it, expect } from 'vitest';
import { uciToShape, pvToShape, countPieces } from '../utils/san';

describe('uciToShape', () => {
  it('convertit un coup simple', () => {
    expect(uciToShape('e2e4')).toEqual({ orig: 'e2', dest: 'e4' });
  });

  it('convertit une promotion (5 caractères)', () => {
    expect(uciToShape('e7e8q')).toEqual({ orig: 'e7', dest: 'e8' });
    expect(uciToShape('a2a1n')).toEqual({ orig: 'a2', dest: 'a1' });
  });

  it('convertit un roque et une prise', () => {
    expect(uciToShape('e1g1')).toEqual({ orig: 'e1', dest: 'g1' });
    expect(uciToShape('d5e6')).toEqual({ orig: 'd5', dest: 'e6' });
  });

  it('rejette les chaînes invalides', () => {
    expect(uciToShape('')).toBeNull();
    expect(uciToShape('e2')).toBeNull();
    expect(uciToShape('z9z9')).toBeNull();
    expect(uciToShape('e7e8x')).toBeNull();
    expect(uciToShape('(none)')).toBeNull();
  });
});

describe('pvToShape', () => {
  it('utilise le premier coup de la PV', () => {
    expect(pvToShape(['e2e4', 'e7e5'], 'paleGreen'))
      .toEqual({ orig: 'e2', dest: 'e4', brush: 'paleGreen' });
  });

  it('gère une promotion en tête de PV', () => {
    expect(pvToShape(['e7e8q'], 'red'))
      .toEqual({ orig: 'e7', dest: 'e8', brush: 'red' });
  });

  it('retourne null pour une PV vide ou absente', () => {
    expect(pvToShape([], 'red')).toBeNull();
    expect(pvToShape(undefined, 'red')).toBeNull();
  });

  it('retourne null pour un coup invalide en tête de PV', () => {
    expect(pvToShape(['zz99'], 'red')).toBeNull();
  });
});

describe('countPieces', () => {
  it('compte les pièces de la position initiale', () => {
    expect(countPieces('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(32);
  });

  it('compte une finale', () => {
    expect(countPieces('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1')).toBe(3);
  });

  it('ignore les compteurs et la partie non-board', () => {
    expect(countPieces('4k3/8/8/8/8/8/8/4K3 b - - 12 40')).toBe(2);
  });
});
