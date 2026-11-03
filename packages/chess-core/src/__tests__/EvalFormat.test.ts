import { describe, it, expect } from 'vitest';
import { formatEval, evalBarShare } from '../utils/evalFormat';

describe('formatEval', () => {
  it('affiche un avantage blanc avec un signe +', () => {
    expect(formatEval(120)).toBe('+1.2');
    expect(formatEval(35)).toBe('+0.4');
  });

  it('affiche un avantage noir avec un signe -', () => {
    expect(formatEval(-120)).toBe('-1.2');
    // Math.round arrondit vers +∞ : -0.35 → -0.3, comme Lichess.
    expect(formatEval(-35)).toBe('-0.3');
    expect(formatEval(-45)).toBe('-0.4');
  });

  it('arrondit au dixième de pion (règle Lichess)', () => {
    // 0.35 → 0.4 (Math.round), là où toFixed donnerait 0.3.
    expect(formatEval(35)).toBe('+0.4');
    expect(formatEval(25)).toBe('+0.3');
  });

  it('affiche 0.0 pour une position égale', () => {
    expect(formatEval(0)).toBe('0.0');
  });

  it('affiche le mat dans les deux sens', () => {
    expect(formatEval(undefined, 3)).toBe('M3');
    expect(formatEval(undefined, -3)).toBe('-M3');
    expect(formatEval(undefined, 1)).toBe('M1');
  });

  it('privilégie le mat sur les centipions', () => {
    expect(formatEval(500, 3)).toBe('M3');
  });

  it('plafonne les valeurs extrêmes comme Lichess (±99)', () => {
    expect(formatEval(50_000)).toBe('+99.0');
    expect(formatEval(-50_000)).toBe('-99.0');
    expect(formatEval(9900)).toBe('+99.0');
  });

  it('gère les valeurs absentes ou invalides', () => {
    expect(formatEval(undefined, undefined)).toBe('0.0');
    expect(formatEval(NaN)).toBe('0.0');
    expect(formatEval(undefined, 0)).toBe('0.0');
  });
});

describe('evalBarShare', () => {
  it('donne 50 % à égalité quelle que soit l\'orientation', () => {
    expect(evalBarShare(0, 'white')).toBe(50);
    expect(evalBarShare(0, 'black')).toBe(50);
  });

  it('donne 100 % au camp affiché en bas quand il gagne', () => {
    expect(evalBarShare(1, 'white')).toBe(100);
    expect(evalBarShare(-1, 'black')).toBe(100);
  });

  it('donne 0 % au camp affiché en bas quand il perd', () => {
    expect(evalBarShare(-1, 'white')).toBe(0);
    expect(evalBarShare(1, 'black')).toBe(0);
  });

  it('inverse bien les deux orientations', () => {
    expect(evalBarShare(0.5, 'white')).toBeCloseTo(75, 6);
    expect(evalBarShare(0.5, 'black')).toBeCloseTo(25, 6);
  });

  it('borne les valeurs hors plage (évite height: NaN%)', () => {
    expect(evalBarShare(NaN, 'white')).toBe(50);
    expect(evalBarShare(5, 'white')).toBe(100);
    expect(evalBarShare(-5, 'white')).toBe(0);
  });
});
