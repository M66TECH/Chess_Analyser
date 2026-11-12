import { describe, it, expect } from 'vitest';
import { MatchSummaryService } from '../analysis/MatchSummaryService';
import type { MoveRecord } from '../pedagogy/types';

describe('MatchSummaryService (P3.16)', () => {
  const createMockRecord = (overrides: Partial<MoveRecord>): MoveRecord => ({
    nodeId: 'node-1',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    playedMove: 'e2e4',
    san: 'e4',
    color: 'white',
    moveNumber: 1,
    cpBefore: 15,
    cpAfter: 20,
    winProbBefore: 50,
    winProbAfter: 52,
    accuracy: 100,
    classification: 'book',
    ...overrides,
  });

  it('génère un rapport vide cohérent pour 0 coup', () => {
    const stats = MatchSummaryService.generateSummary([]);
    expect(stats.accuracy.white).toBe(0);
    expect(stats.accuracy.black).toBe(0);
  });

  it('calcule la distribution des 9 classifications pour les deux camps', () => {
    const records: MoveRecord[] = [
      createMockRecord({ color: 'white', classification: 'book' }),
      createMockRecord({ color: 'black', classification: 'book' }),
      createMockRecord({ color: 'white', classification: 'brilliant' }),
      createMockRecord({ color: 'black', classification: 'great' }),
      createMockRecord({ color: 'white', classification: 'best' }),
      createMockRecord({ color: 'black', classification: 'blunder' }),
    ];

    const stats = MatchSummaryService.generateSummary(records);
    expect(stats.classificationCounts?.white.brilliant).toBe(1);
    expect(stats.classificationCounts?.white.best).toBe(1);
    expect(stats.classificationCounts?.black.great).toBe(1);
    expect(stats.classificationCounts?.black.blunder).toBe(1);
  });

  it('identifie le moment critique / tournant décisif du match', () => {
    const records: MoveRecord[] = [
      createMockRecord({
        moveNumber: 1,
        color: 'white',
        classification: 'book',
        winProbBefore: 50,
        winProbAfter: 50,
      }),
      createMockRecord({
        moveNumber: 1,
        color: 'black',
        classification: 'good',
        winProbBefore: 50,
        winProbAfter: 48,
      }),
      createMockRecord({
        nodeId: 'crit-blunder',
        moveNumber: 18,
        color: 'black',
        san: 'Qxa2??',
        playedMove: 'd8a2',
        bestMove: 'f8e8',
        classification: 'blunder',
        winProbBefore: 45,
        winProbAfter: 5, // -40% drop
        cpBefore: 0,
        cpAfter: 550,
      }),
    ];

    const stats = MatchSummaryService.generateSummary(records);
    expect(stats.criticalMoment).toBeDefined();
    expect(stats.criticalMoment?.color).toBe('black');
    expect(stats.criticalMoment?.moveNumber).toBe(18);
    expect(stats.criticalMoment?.san).toBe('Qxa2??');
    expect(stats.takeaway).toContain('Tournant du match au coup 18');
  });

  it('calcule les précisions par phase (Ouverture / Milieu / Finale)', () => {
    // 20 coups simulés
    const records: MoveRecord[] = Array.from({ length: 20 }, (_, i) =>
      createMockRecord({
        nodeId: `move-${i}`,
        moveNumber: Math.floor(i / 2) + 1,
        color: i % 2 === 0 ? 'white' : 'black',
        classification: 'best',
        cpBefore: 20,
        cpAfter: 20,
      })
    );

    const stats = MatchSummaryService.generateSummary(records);
    expect(stats.phaseStats).toBeDefined();
    expect(stats.phaseStats?.opening).toBeDefined();
  });

  it('identifie les motifs récurrents d\'erreur et les intègre au bilan (I1)', () => {
    // 2 coups avec réseau de mat concédé pour les Noirs
    const records: MoveRecord[] = [
      createMockRecord({
        nodeId: 'm1',
        moveNumber: 15,
        color: 'black',
        classification: 'blunder',
        mateSequence: 'created',
      }),
      createMockRecord({
        nodeId: 'm2',
        moveNumber: 20,
        color: 'black',
        classification: 'blunder',
        mateSequence: 'created',
      }),
    ];

    const stats = MatchSummaryService.generateSummary(records);
    expect(stats.recurrentThemes).toBeDefined();
    expect(stats.recurrentThemes?.black.length).toBeGreaterThanOrEqual(1);
    expect(stats.recurrentThemes?.black[0].theme).toBe('Réseau de mat concédé');
    expect(stats.takeaway).toContain('Noirs : vigilance sur réseau de mat concédé');
  });

  it('convertit correctement l’échelle [-1, 1] des chances de gain et évite undefined sur bestMove manquant', () => {
    const records: MoveRecord[] = [
      createMockRecord({
        nodeId: 'm1',
        moveNumber: 12,
        color: 'white',
        san: 'Dh5??',
        classification: 'blunder',
        winProbBefore: 0.4,
        winProbAfter: -0.6,
        bestMove: undefined,
      }),
    ];

    const stats = MatchSummaryService.generateSummary(records);
    expect(stats.criticalMoment).toBeDefined();
    expect(Math.round((stats.criticalMoment?.winDrop ?? 0) * 100)).toBe(50);
    expect(stats.criticalMoment?.description).toContain('50%');
    expect(stats.criticalMoment?.description).not.toContain('undefined');
  });
});
