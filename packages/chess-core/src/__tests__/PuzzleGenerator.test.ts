import { describe, it, expect } from 'vitest';
import { extractPuzzlesFromGame } from '../pedagogy/PuzzleGenerator';
import type { MoveRecord } from '../pedagogy/types';

describe('PuzzleGenerator (P3.15)', () => {
  const createMockRecord = (overrides: Partial<MoveRecord>): MoveRecord => ({
    nodeId: 'node-1',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    playedMove: 'e2e4',
    san: 'e4',
    color: 'white',
    moveNumber: 1,
    cpBefore: 15,
    cpAfter: 15,
    winProbBefore: 50,
    winProbAfter: 50,
    accuracy: 100,
    classification: 'good',
    ...overrides,
  });

  it('retourne un tableau vide s’il n’y a aucune gaffe ou erreur', () => {
    const records = [
      createMockRecord({ classification: 'best', bestMove: 'e2e4' }),
      createMockRecord({ classification: 'good', bestMove: 'e7e5' }),
      createMockRecord({ classification: 'excellent', bestMove: 'g1f3' }),
    ];
    const puzzles = extractPuzzlesFromGame(records);
    expect(puzzles).toEqual([]);
  });

  it('extrait et formate correctement un puzzle pour une gaffe', () => {
    const blunder = createMockRecord({
      nodeId: 'node-blunder-1',
      moveNumber: 12,
      color: 'white',
      classification: 'blunder',
      fenBefore: 'r1bqk2r/pp2bppp/2n1pn2/2pp4/2PP4/2N1PN2/PP2BPPP/R1BQK2R w KQkq - 0 7',
      playedMove: 'd4c5',
      san: 'dxc5',
      bestMove: 'e1g1',
      bestPv: ['e1g1', 'c5d4', 'e3d4'],
      cpBefore: 60,
      cpAfter: -250,
      explanation: 'Le roque assurait la sécurité du Roi avant d’ouvrir le centre.',
    });

    const puzzles = extractPuzzlesFromGame([blunder]);
    expect(puzzles.length).toBe(1);

    const puzzle = puzzles[0];
    expect(puzzle.id).toBe('puzzle-node-blunder-1');
    expect(puzzle.moveNumber).toBe(12);
    expect(puzzle.color).toBe('white');
    expect(puzzle.severity).toBe('blunder');
    expect(puzzle.blunderSan).toBe('dxc5');
    expect(puzzle.solutionUci).toBe('e1g1');
    expect(puzzle.solutionSan).toBe('O-O'); // Converti en SAN !
    expect(puzzle.solutionPv).toEqual(['e1g1', 'c5d4', 'e3d4']);
    expect(puzzle.theme).toBeTruthy();
    expect(puzzle.hint).toBeTruthy();
    expect(puzzle.centipawnLoss).toBe(310);
  });

  it('ordonne les puzzles en plaçant les gaffes avant les erreurs simples', () => {
    const mistake = createMockRecord({
      nodeId: 'node-mistake',
      classification: 'mistake',
      bestMove: 'd2d4',
      cpBefore: 50,
      cpAfter: -30,
    });
    const blunder = createMockRecord({
      nodeId: 'node-blunder',
      classification: 'blunder',
      bestMove: 'g1f3',
      cpBefore: 100,
      cpAfter: -200,
    });

    const puzzles = extractPuzzlesFromGame([mistake, blunder]);
    expect(puzzles.length).toBe(2);
    expect(puzzles[0].severity).toBe('blunder');
    expect(puzzles[1].severity).toBe('mistake');
  });

  it('ignore les gaffes sans bestMove disponible', () => {
    const broken = createMockRecord({
      classification: 'blunder',
      bestMove: undefined,
    });
    expect(extractPuzzlesFromGame([broken])).toEqual([]);
  });
});
