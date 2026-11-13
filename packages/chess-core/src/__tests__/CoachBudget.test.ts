import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExplanationEngine } from '../pedagogy/ExplanationEngine';
import { RiverAPI } from '../pedagogy/RiverAPI';
import type { MoveRecord } from '../pedagogy/types';

/**
 * P1-9 (rev. 2) : budget LLM par session (200) consommé UNIQUEMENT sur
 * appel réussi. Vérifie aussi que les échecs réseau ne gaspillent pas le
 * budget et que le badge `degraded` est correctement positionné.
 */
function record(overrides: Partial<MoveRecord> = {}): MoveRecord {
  return {
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    playedMove: 'e2e4',
    bestMove: 'e2e4',
    bestPv: ['e2e4', 'e7e5'],
    cpBefore: 20,
    cpAfter: 20,
    winProbBefore: 0,
    winProbAfter: 0,
    accuracy: 100,
    classification: 'best',
    moveNumber: 1,
    color: 'white',
    san: 'e4',
    nodeId: 'n1',
    ...overrides,
  };
}

const GOOD_JSON =
  '{"headline":"Bravo !","insights":[{"kind":"played_move","text":"Le pion va au centre en e4."}],"takeaway":"Continuez ainsi."}';

describe('P1-9 rev.2 : budget LLM consommé uniquement sur succès', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    ExplanationEngine.resetLlmBudget();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ExplanationEngine.resetLlmBudget();
  });

  it('carte LLM valide : budget -1, pas de badge dégradé', async () => {
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue(GOOD_JSON);
    const card = await ExplanationEngine.generateCard(record(), 'debutant');
    expect(card.degraded).toBeUndefined();
    expect(ExplanationEngine.remainingLlmBudget).toBe(199);
  });

  it('échec réseau : budget NON consommé, badge dégradé', async () => {
    vi.spyOn(RiverAPI, 'complete').mockRejectedValue(new Error('offline'));
    const card = await ExplanationEngine.generateCard(record(), 'debutant');
    expect(card.degraded).toBe(true);
    expect(ExplanationEngine.remainingLlmBudget).toBe(200);
  });

  it('200 appels réussis : budget épuisé, le 201e bascule sans réseau', async () => {
    const spy = vi.spyOn(RiverAPI, 'complete').mockResolvedValue(GOOD_JSON);

    for (let i = 0; i < 200; i++) {
      await ExplanationEngine.generateCard(record(), 'debutant');
    }
    expect(ExplanationEngine.remainingLlmBudget).toBe(0);

    const spyCallCount = spy.mock.calls.length;
    const card201 = await ExplanationEngine.generateCard(record(), 'debutant');
    expect(spy.mock.calls.length).toBe(spyCallCount); // pas d'appel réseau
    expect(card201.degraded).toBe(true);
    expect(card201.headline.length).toBeGreaterThan(0);
  });

  it('buildLocalCard ne consomme pas de budget', () => {
    ExplanationEngine.buildLocalCard(record(), 'debutant');
    expect(ExplanationEngine.remainingLlmBudget).toBe(200);
  });

  it('generateDemoCaptions consomme le budget uniquement sur appel réussi', async () => {
    vi.spyOn(RiverAPI, 'complete').mockRejectedValue(new Error('network'));
    const captions = await ExplanationEngine.generateDemoCaptions({
      startFen: record().fenBefore,
      uciMoves: ['e2e4'],
      kind: 'idea',
      fallbackCaptions: ['Le pion avance.'],
    });
    expect(captions).toEqual(['Le pion avance.']); // fallback
    expect(ExplanationEngine.remainingLlmBudget).toBe(200); // pas consommé
  });
});
