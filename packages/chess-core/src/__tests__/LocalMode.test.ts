import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalMode } from '../services/LocalMode';
import { OpeningExplorer } from '../explorer/OpeningExplorer';
import { ExplanationEngine } from '../pedagogy/ExplanationEngine';
import { RiverAPI } from '../pedagogy/RiverAPI';
import type { MoveRecord } from '../pedagogy/types';

/**
 * P3.14 — mode local strict : AUCUNE requête sortante.
 * DoD : « en mode local, l'onglet Réseau n'émet aucune requête externe ».
 * On vérifie ici les garde-fous au niveau des services.
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

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('LocalMode (P3.14)', () => {
  beforeEach(() => {
    LocalMode.reset();
    ExplanationEngine.resetLlmBudget();
  });

  afterEach(() => {
    LocalMode.reset();
    vi.restoreAllMocks();
  });

  it('est désactivé par défaut (mode connecté)', () => {
    expect(LocalMode.enabled).toBe(false);
    expect(LocalMode.allowRemote('test')).toBe(true);
  });

  it('toggle bascule et allowRemote refuse quand actif', () => {
    expect(LocalMode.toggle()).toBe(true);
    expect(LocalMode.enabled).toBe(true);
    expect(LocalMode.allowRemote('test')).toBe(false);
    expect(LocalMode.toggle()).toBe(false);
  });

  it('notifie les abonnés', () => {
    const spy = vi.fn();
    LocalMode.onChange(spy);
    LocalMode.enabled = true;
    expect(spy).toHaveBeenCalledWith(true);
  });

  describe('coupure du coach LLM', () => {
    it('aucun appel réseau : fallback local avec badge dégradé', async () => {
      const llm = vi.spyOn(RiverAPI, 'complete');
      LocalMode.enabled = true;

      const card = await ExplanationEngine.generateCard(record(), 'debutant');

      expect(llm).not.toHaveBeenCalled(); // zéro réseau
      expect(card.degraded).toBe(true); // transparence
      expect(card.insights.length).toBeGreaterThan(0);
    });

    it('ne consomme pas le budget LLM', async () => {
      LocalMode.enabled = true;
      await ExplanationEngine.generateCard(record(), 'debutant');
      expect(ExplanationEngine.remainingLlmBudget).toBe(40);
    });
  });

  describe('coupure de l\'explorateur Lichess', () => {
    it('aucun fetch : retourne null (ou le cache existant)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      LocalMode.enabled = true;

      const result = await OpeningExplorer.fetchWithOpening(START);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
    });
  });

  it('réactivé : les appels repartent', async () => {
    const llm = vi.spyOn(RiverAPI, 'complete').mockResolvedValue(
      '{"headline":"X","insights":[],"takeaway":"Y"}'
    );
    LocalMode.enabled = false;
    await ExplanationEngine.generateCard(record(), 'debutant');
    expect(llm).toHaveBeenCalledTimes(1);
  });
});

describe('LocalMode — ExplorerService (panneau explorateur / tablebase)', () => {
  beforeEach(() => LocalMode.reset());
  afterEach(() => {
    LocalMode.reset();
    vi.restoreAllMocks();
  });

  it('ne déclenche aucun fetch ni vers /api/explorer ni vers /api/tablebase', async () => {
    const { ExplorerService } = await import('../services/ExplorerService');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    LocalMode.enabled = true;

    // 32 pièces → explorateur d'ouvertures ; 3 pièces → tablebase.
    const opening = await ExplorerService.fetch('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 7');
    const endgame = await ExplorerService.fetch('8/8/8/4k3/8/8/4K3/4R3 w - - 0 90');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(opening).toBeNull();
    expect(endgame).toBeNull();
  });
});
