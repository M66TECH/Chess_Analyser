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

  describe('importTree', () => {
    it('importe un arbre de nœuds et permet la navigation', () => {
      const mm = new MoveManager();
      const nodes = new Map();
      nodes.set('node_1', {
        id: 'node_1',
        uci: 'e2e4',
        san: 'e4',
        fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        moveNumber: 1,
        color: 'white',
        parentId: null,
        childrenIds: ['node_2', 'node_3'],
        isMainline: true,
      });
      nodes.set('node_2', {
        id: 'node_2',
        uci: 'e7e5',
        san: 'e5',
        fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        fenAfter: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        moveNumber: 1,
        color: 'black',
        parentId: 'node_1',
        childrenIds: [],
        isMainline: true,
      });
      nodes.set('node_3', {
        id: 'node_3',
        uci: 'c7c5',
        san: 'c5',
        fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        fenAfter: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2',
        moveNumber: 1,
        color: 'black',
        parentId: 'node_1',
        childrenIds: [],
        isMainline: false,
      });

      mm.importTree(nodes);
      expect(mm.getTree().nodes.size).toBe(3);

      // Par défaut positionné sur le dernier coup mainline (node_2)
      expect(mm.getTree().currentNodeId).toBe('node_2');
      expect(mm.getFen()).toContain('rnbqkbnr/pppp1ppp/8/4p3/4P3');

      // Navigation vers la variante (node_3)
      mm.goToNode('node_3');
      expect(mm.getTree().currentNodeId).toBe('node_3');
      expect(mm.getFen()).toContain('2p5');
    });
  });

  describe('isPromotion', () => {
    it('détecte correctement une promotion légale et refuse les coups non-promotions', () => {
      const mm = new MoveManager('k7/4P3/8/8/8/8/8/4K3 w - - 0 1');
      expect(mm.isPromotion('e7', 'e8')).toBe(true);
      expect(mm.isPromotion('a1', 'a2')).toBe(false);

      // Promotion par prise
      const mmCapture = new MoveManager('k2r4/4P3/8/8/8/8/8/4K3 w - - 0 1');
      expect(mmCapture.isPromotion('e7', 'd8')).toBe(true);

      // Pièce clouée : promotion illégale refusée
      const mmPinned = new MoveManager('4r3/8/8/8/8/8/4P3/4K3 w - - 0 1');
      expect(mmPinned.isPromotion('e2', 'e1')).toBe(false);
    });
  });
});
