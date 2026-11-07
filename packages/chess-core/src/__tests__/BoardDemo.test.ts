import { describe, it, expect } from 'vitest';
import { buildDemo, describeMove } from '../pedagogy/MoveNarrator';

/**
 * Le bouton « Montrer sur l'échiquier » doit produire une démonstration
 * utilisable dans les deux cas prévus par la consigne :
 *  1. punir une erreur  → réfutation depuis la position APRÈS le coup ;
 *  2. montrer l'idée    → meilleure ligne depuis la position AVANT le coup.
 */
const AFTER_BLUNDER = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

describe('Démonstration — construction depuis une analyse', () => {
  it('réfutation : la suite part de la position après le coup fautif', () => {
    // Après 1.e4 d5, les Blancs peuvent prendre : exd5.
    const steps = buildDemo(AFTER_BLUNDER, ['e4d5', 'd8d5'], 6);
    expect(steps).toHaveLength(2);
    // Le premier coup est décrit sans notation, pièce + case.
    expect(steps[0].caption).toContain('pion');
    expect(steps[0].caption).toContain('d5');
    expect(steps[0].caption).not.toMatch(/^[a-h][1-8]/);
    // Les deux camps alternent : le second coup est joué par l'adversaire.
    expect(steps[1].caption).toContain('dame');
  });

  it('meilleure ligne : la suite part de la position avant le coup', () => {
    const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const steps = buildDemo(START, ['d2d4', 'd7d5', 'c2c4'], 6);
    expect(steps).toHaveLength(3);
    expect(steps[0].caption).toContain('pion');
    expect(steps[0].from).toBe('d2');
    expect(steps[0].to).toBe('d4');
  });

  it('chaque étape fournit les cases à surligner et la menace éventuelle', () => {
    // Dame h1 → e1 : échec le long de la colonne e (e2..e7 vides).
    const fen = '4k3/8/8/8/8/8/8/K6Q w - - 0 1';
    const steps = buildDemo(fen, ['h1e1'], 2);
    expect(steps).toHaveLength(1);
    expect(steps[0].check).toBe(true);
    expect(steps[0].threat).toBe('e8');
    expect(steps[0].highlight).toEqual(['h1', 'e1']);
  });

  it('la démonstration ne dépasse jamais 3 coups complets (6 demi-coups)', () => {
    const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const longPv = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6'];
    expect(buildDemo(START, longPv, 6)).toHaveLength(6);
  });

  it('une position terminale arrête la suite', () => {
    const beforeMate = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const steps = buildDemo(beforeMate, ['h5f7'], 6);
    expect(steps).toHaveLength(1);
    expect(steps[0].checkmate).toBe(true);
    expect(steps[0].caption).toContain('mat');
  });
});

describe('Démonstration — lisibilité débutant', () => {
  it('aucune étape ne contient de notation brute', () => {
    const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const steps = buildDemo(START, ['g1f3', 'g8f6', 'f3e5', 'f6e4'], 6);
    const SAN = /\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]\b/;
    const UCI = /\b[a-h][1-8][a-h][1-8]\b/;
    for (const step of steps) {
      expect(step.caption).not.toMatch(SAN);
      expect(step.caption).not.toMatch(UCI);
    }
  });

  it('describeMove reste compréhensible seul', () => {
    const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const d = describeMove(START, 'e2e4')!;
    expect(d.text).toBe('Le pion va en e4.');
  });
});
