import { describe, it, expect } from 'vitest';
import { MoveClassifier } from '../pedagogy/MoveClassifier';

/**
 * The opening database exists to stop Stockfish from grading real theory as a
 * mistake. These tests pin that contract at the classifier level.
 */
describe('MoveClassifier — théorie des ouvertures', () => {
  it('pénalise un coup perdant hors théorie', () => {
    const result = MoveClassifier.classify(0.45);
    expect(result.classification).toBe('blunder');
  });

  it('ne sanctionne pas un coup de théorie même si Stockfish voit mieux', () => {
    // Stockfish: -45% de chances, mais les humains jouent ce coup depuis 200 ans.
    const result = MoveClassifier.classify(0.45, { isTheory: true });
    expect(result.classification).toBe('good');
  });

  it('applique la même indulgence aux erreurs et imprécisions théoriques', () => {
    expect(MoveClassifier.classify(0.15, { isTheory: true }).classification).toBe('good');
    expect(MoveClassifier.classify(0.25, { isTheory: true }).classification).toBe('good');
  });

  it('laisse intactes les bonnes classifications théoriques', () => {
    expect(MoveClassifier.classify(0.02, { isTheory: true, isBestMove: true }).classification).toBe('best');
    expect(MoveClassifier.classify(-0.2, { isTheory: true }).classification).toBe('brilliant');
  });

  it('reste rétrocompatible avec l\'ancien appel booléen', () => {
    expect(MoveClassifier.classify(0, true).classification).toBe('best');
    expect(MoveClassifier.classify(0.45, false).classification).toBe('blunder');
  });

  it('ne modifie pas l\'accuracy calculée', () => {
    const withoutTheory = MoveClassifier.classify(0.45);
    const withTheory = MoveClassifier.classify(0.45, { isTheory: true });
    expect(withTheory.accuracy).toBe(withoutTheory.accuracy);
  });
});
