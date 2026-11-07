import { describe, it, expect } from 'vitest';
import { MoveManager } from '../services/MoveManager';

/**
 * `getIrreversibleHistory` alimente `position fen <root> moves …` envoyé à
 * Stockfish (détection des nulles par répétition, `ceval/ctrl.ts` de lila).
 *
 * La sémantique est subtile : `halfmoves === 0` **après** un coup signifie que
 * ce coup est irréversible. La racine doit donc être la position AVANT ce coup,
 * et la liste de coups doit COMMENCER par lui. Une implémentation précédente
 * partait de `fenAfter` et sautait le coup → position reconstruite fausse.
 */
describe('MoveManager.getIrreversibleHistory', () => {
  it('position initiale : racine = FEN initial, aucun coup', () => {
    const mm = new MoveManager();
    const history = mm.getIrreversibleHistory();
    expect(history.rootFen).toBe(mm.getInitialFen());
    expect(history.moves).toEqual([]);
  });

  it('sans coup irréversible : toute la branche depuis la racine', () => {
    const mm = new MoveManager();
    // Caf3/Cc6/Cf3/Cb8… : 4 demi-coups sans pion, prise ni roque.
    // (Les coups de cavalier ne remettent pas `halfmoves` à 0.)
    mm.playMove('g1f3');
    mm.playMove('g8f6');
    const history = mm.getIrreversibleHistory();
    expect(history.rootFen).toBe(mm.getInitialFen());
    expect(history.moves).toEqual(['g1f3', 'g8f6']);
  });

  it('repart APRÈS le dernier coup irréversible, sans dupliquer ce coup', () => {
    const mm = new MoveManager();
    mm.playMove('g1f3'); // calme
    mm.playMove('g8f6'); // calme
    mm.playMove('e2e4'); // pion → halfmoves remis à 0
    mm.playMove('e7e5'); // pion → halfmoves remis à 0 (dernier irréversible)
    mm.playMove('g1f3'); // illégal après e4, ignoré
    mm.playMove('b1c3'); // calme

    const history = mm.getIrreversibleHistory();

    // La racine doit être la position AVANT e7e5, c'est-à-dire après e2e4.
    expect(history.rootFen).not.toBe(mm.getInitialFen());
    // Et la séquence doit recommencer par e7e5 (pas après).
    expect(history.moves[0]).toBe('e7e5');
    expect(history.moves).toContain('b1c3');
    // Le coup irréversible ne doit apparaître qu'une fois.
    expect(history.moves.filter(m => m === 'e7e5')).toHaveLength(1);
  });

  it('la racine + les coups reconstruisent exactement le FEN courant', () => {
    // Test de bout en bout de la convention : c'est la vraie garantie.
    const mm = new MoveManager();
    mm.playMove('e2e4');
    mm.playMove('e7e5');
    mm.playMove('g1f3');
    mm.playMove('b8c6');

    const { rootFen, moves } = mm.getIrreversibleHistory();

    const replay = new MoveManager(rootFen);
    for (const uci of moves) {
      const res = replay.playMove(uci);
      expect(res.success, `rejeu de ${uci}`).toBe(true);
    }

    const key = (fen: string) => fen.split(' ').slice(0, 4).join(' ');
    expect(key(replay.getFen())).toBe(key(mm.getFen()));
  });

  it('roque traité comme irréversible (halfmoves=0)', () => {
    const mm = new MoveManager('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    mm.playMove('e1g1'); // O-O
    const history = mm.getIrreversibleHistory();
    expect(history.moves).toHaveLength(1);
    expect(history.moves[0]).toBe('e1g1');
    expect(history.rootFen).toContain('R3K2R w');
  });
});
