import { describe, it, expect } from 'vitest';
import { MoveManager } from '../services/MoveManager';

describe('MoveManager', () => {
  describe('constructeur', () => {
    it('initialise la position de départ par défaut', () => {
      const mm = new MoveManager();
      const fen = mm.getFen();
      expect(fen).toContain('rnbqkbnr');
      expect(fen).toContain('RNBQKBNR');
    });

    it('accepte un FEN valide en paramètre', () => {
      // FEN avec un roi de chaque côté (position légale minimale)
      const mm = new MoveManager('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
      const result = mm.getFen();
      // chessops peut normaliser le FEN, on vérifie juste qu'il contient les rois
      expect(result).toContain('k');
      expect(result).toContain('K');
      expect(mm.getMoveCount()).toBe(0);
    });

    it('utilise la position initiale pour un FEN invalide (C3)', () => {
      // Ne doit PAS crasher
      const mm = new MoveManager('fen_invalide_!!');
      expect(mm.getFen()).toBeTruthy();
      expect(mm.getMoveCount()).toBe(0);
    });
  });

  describe('playMove', () => {
    it('joue un coup légal', () => {
      const mm = new MoveManager();
      const result = mm.playMove('e2e4');
      expect(result.success).toBe(true);
      expect(result.san).toBe('e4');
      expect(result.fenBefore).toBeTruthy();
      expect(mm.getMoveCount()).toBe(1);
    });

    it('rejette un coup illégal', () => {
      const mm = new MoveManager();
      const result = mm.playMove('e1e8'); // coup impossible
      expect(result.success).toBe(false);
      expect(mm.getMoveCount()).toBe(0);
    });

    it('auto-promotion en dame pour un pion atteignant la 8e rangée (L4)', () => {
      // Position valide : pion blanc e7, roi noir a8, roi blanc a1
      // Le roi noir est loin de la case de promotion e8
      const mm = new MoveManager('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
      const result = mm.playMove('e7e8'); // sans promotion explicite
      expect(result.success).toBe(true);
    });

    it('accepte la promotion UCI explicite', () => {
      // Position valide : pion blanc e7, roi noir a8, roi blanc a1
      const mm = new MoveManager('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
      const result = mm.playMove('e7e8q');
      expect(result.success).toBe(true);
    });

    it('rejette un coup UCI invalide', () => {
      const mm = new MoveManager();
      const result = mm.playMove('XXXX');
      expect(result.success).toBe(false);
    });

    it('accumule l\'historique des mouvements', () => {
      const mm = new MoveManager();
      mm.playMove('e2e4');
      mm.playMove('e7e5');
      mm.playMove('g1f3');
      expect(mm.getMoveCount()).toBe(3);
      expect(mm.getUciMoves()).toEqual(['e2e4', 'e7e5', 'g1f3']);
    });
  });

  describe('reset', () => {
    it('remet la position à l\'état initial', () => {
      const mm = new MoveManager();
      mm.playMove('e2e4');
      mm.playMove('e7e5');
      mm.reset();
      expect(mm.getMoveCount()).toBe(0);
      expect(mm.getFen()).toContain('rnbqkbnr');
    });

    it('reset avec FEN invalide ne crashe pas (C3)', () => {
      const mm = new MoveManager();
      mm.reset('fen_invalide');
      expect(mm.getMoveCount()).toBe(0);
    });
  });

  describe('getFenAtIndex', () => {
    it('retourne le FEN initial à l\'index 0', () => {
      const mm = new MoveManager();
      const fen0 = mm.getFenAtIndex(0);
      expect(fen0).toBeTruthy();
      expect(fen0).toContain('rnbqkbnr');
    });

    it('retourne le FEN après un coup à l\'index 1', () => {
      const mm = new MoveManager();
      mm.playMove('e2e4');
      const fen1 = mm.getFenAtIndex(1);
      expect(fen1).toBeTruthy();
      expect(fen1).toContain(' b '); // c'est aux noirs de jouer
    });

    it('retourne null pour un index hors limites', () => {
      const mm = new MoveManager();
      expect(mm.getFenAtIndex(99)).toBeNull();
      expect(mm.getFenAtIndex(-1)).toBeNull();
    });
  });
});
