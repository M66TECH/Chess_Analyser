import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExplanationEngine } from '../pedagogy/ExplanationEngine';
import { RiverAPI } from '../pedagogy/RiverAPI';
import type { MoveRecord } from '../pedagogy/types';

/**
 * P1-9 : budget LLM par session (40 appels max) et badge `degraded`
 * quand la carte vient du fallback. Un import PGN de 80 coups ne doit
 * pas ruiner la clé API, et l'utilisateur doit savoir quand il lit une
 * explication locale.
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

describe('P1-9 : budget LLM de session + badge dégradé', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    ExplanationEngine.resetLlmBudget();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ExplanationEngine.resetLlmBudget();
  });

  it('une carte LLM valide n\'est PAS dégradée', async () => {
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue(GOOD_JSON);
    const card = await ExplanationEngine.generateCard(record(), 'debutant');
    expect(card.degraded).toBeUndefined();
    expect(card.headline).toBe('Bravo !');
    expect(ExplanationEngine.remainingLlmBudget).toBe(39);
  });

  it('un échec LLM produit une carte locale avec degraded=true', async () => {
    vi.spyOn(RiverAPI, 'complete').mockRejectedValue(new Error('network down'));
    const card = await ExplanationEngine.generateCard(record(), 'debutant');
    expect(card.degraded).toBe(true);
    expect(card.headline.length).toBeGreaterThan(0); // pas vide
    expect(card.insights.length).toBeGreaterThan(0);
    expect(card.takeaway.length).toBeGreaterThan(0);
  });

  it('une réponse non parseable produit degraded=true', async () => {
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue('n\'est pas du json');
    const card = await ExplanationEngine.generateCard(record(), 'debutant');
    expect(card.degraded).toBe(true);
  });

  it('le budget de session (40) est respecté : le 41e appel bascule sans réseau', async () => {
    const spy = vi.spyOn(RiverAPI, 'complete').mockResolvedValue(GOOD_JSON);

    // 40 appels : le budget est consommé.
    for (let i = 0; i < 40; i++) {
      const card = await ExplanationEngine.generateCard(record(), 'debutant');
      expect(card.degraded).toBeUndefined();
    }
    expect(ExplanationEngine.remainingLlmBudget).toBe(0);

    // Le 41e : fallback immédiat, AUCUN appel réseau de plus.
    const before = spy.mock.calls.length;
    const card41 = await ExplanationEngine.generateCard(record(), 'debutant');
    expect(spy.mock.calls.length).toBe(before); // pas de nouvel appel
    expect(card41.degraded).toBe(true);
  });

  it('buildLocalCard ne consomme pas de budget', () => {
    const card = ExplanationEngine.buildLocalCard(record(), 'debutant');
    expect(card.degraded).toBeUndefined(); // carte locale volontaire, pas un repli
    expect(ExplanationEngine.remainingLlmBudget).toBe(40);
  });
});
