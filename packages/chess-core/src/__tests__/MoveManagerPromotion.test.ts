import { describe, it, expect } from 'vitest';
import { MoveManager } from '../services/MoveManager';

/**
 * `isPromotion` remplace l'heuristique « pion sur la 8e rangée » de l'UI.
 * Elle doit se baser sur la légalité réelle du coup, pas sur la rangée :
 * un pion cloué ou bloqué ne peut pas promouvoir.
 */
describe('MoveManager.isPromotion', () => {
  const PROMO = 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1';

  it('détecte une promotion simple', () => {
    const mm = new MoveManager(PROMO);
    expect(mm.isPromotion('e7', 'e8')).toBe(true);
  });

  it('détecte une promotion par prise', () => {
    // Roi noir en a8 (hors de portée), tour noire en d8 : e7xd8 est une
    // promotion par capture.
    const mm = new MoveManager('k2r4/4P3/8/8/8/8/8/4K3 w - - 0 1');
    expect(mm.isPromotion('e7', 'd8')).toBe(true);
  });

  it('détecte la promotion des Noirs', () => {
    const mm = new MoveManager('4k3/8/8/8/8/8/4p3/K7 b - - 0 1');
    expect(mm.isPromotion('e2', 'e1')).toBe(true);
  });

  it('refuse un coup de pion qui n\'atteint pas la dernière rangée', () => {
    const mm = new MoveManager();
    expect(mm.isPromotion('e2', 'e4')).toBe(false);
  });

  it('refuse une pièce qui n\'est pas un pion', () => {
    const mm = new MoveManager('k7/8/8/8/8/8/8/4R1K1 w - - 0 1');
    expect(mm.isPromotion('e1', 'e8')).toBe(false);
  });

  it('refuse une case de départ vide', () => {
    const mm = new MoveManager(PROMO);
    expect(mm.isPromotion('a1', 'a2')).toBe(false);
  });

  it('refuse une promotion illégale (pion cloué au roi)', () => {
    // Roi blanc e1, pion e2 cloué par la tour noire e8 : e2-e1 n'existe pas,
    // mais surtout le pion ne peut pas avancer sans exposer le roi.
    const mm = new MoveManager('4r3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    expect(mm.isPromotion('e2', 'e1')).toBe(false);
  });

  it('refuse une destination hors échiquier', () => {
    const mm = new MoveManager(PROMO);
    expect(mm.isPromotion('e7', 'e9')).toBe(false);
    expect(mm.isPromotion('zz', 'e8')).toBe(false);
  });

  it('reste correcte après navigation dans l\'arbre', () => {
    const mm = new MoveManager(PROMO);
    mm.playMove('e7e8q');
    // Après promotion, le pion n'existe plus : plus aucune promotion possible.
    expect(mm.isPromotion('e7', 'e8')).toBe(false);
  });
});
