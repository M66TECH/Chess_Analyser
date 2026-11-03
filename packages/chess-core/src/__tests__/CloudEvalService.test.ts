import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudEvalService } from '../services/CloudEvalService';
import type { CloudEvalHit } from '../services/CloudEvalService';

/**
 * Cloud Eval — portage de `ui/analyse/src/evalCache.ts` :
 * cache par FEN, awaiting pendant le vol, hit réémis instantanément,
 * `toCeval` (moves "a b", cp/mate par PV) — plus la conversion POV :
 * les pvs du cloud sont POV Blanc, nos évals POV trait.
 */
const WHITE_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function hit(fen: string, overrides: Partial<CloudEvalHit> = {}): CloudEvalHit {
  return {
    fen,
    knodes: 12_345,
    depth: 25,
    pvs: [
      { moves: 'e2e4 e7e5', cp: 30 },
      { moves: 'd2d4 d7d5', cp: 25 },
      { moves: 'g1f3', cp: 20 },
    ],
    ...overrides,
  };
}

const ORIGIN = 'https://unit.test';

function mockFetch(sequence: Array<{ status: number; body?: unknown }>) {
  let call = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    const next = sequence[Math.min(call++, sequence.length - 1)];
    return Promise.resolve({
      ok: next.status === 200,
      status: next.status,
      json: () => Promise.resolve(next.body),
    } as unknown as Response);
  });
}

describe('CloudEvalService', () => {
  beforeEach(() => {
    CloudEvalService.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('convertit un hit multi-PV : POV Blanc inchangé au trait Blanc', async () => {
    const fetchSpy = mockFetch([{ status: 200, body: hit(WHITE_TO_MOVE) }]);
    const promise = CloudEvalService.fetch(WHITE_TO_MOVE, 3, ORIGIN);
    await vi.runAllTimersAsync();
    const evals = await promise;

    expect(evals).toHaveLength(3);
    expect(evals![0].cp).toBe(30); // POV Blanc = POV trait : pas d'inversion
    expect(evals![0].multiPv).toBe(1);
    expect(evals![0].source).toBe('cloud');
    expect(evals![0].fen).toBe(WHITE_TO_MOVE);
    expect(evals![0].depth).toBe(25);
    expect(evals![0].nodes).toBe(12_345_000);
    expect(evals![0].pv).toEqual(['e2e4', 'e7e5']);
    expect(evals![1].multiPv).toBe(2);
    expect(evals![2].multiPv).toBe(3);

    // Une seule requête pour les 3 PV (adaptateur REST unique).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain('/api/cloud-eval?');
    expect(fetchSpy.mock.calls[0][0]).toContain(encodeURIComponent(WHITE_TO_MOVE));
    expect(fetchSpy.mock.calls[0][0]).toContain('multiPv=3');
  });

  it('inverse les scores quand le trait est aux Noirs (POV Blanc → POV trait)', async () => {
    mockFetch([{ status: 200, body: hit(BLACK_TO_MOVE) }]);
    const promise = CloudEvalService.fetch(BLACK_TO_MOVE, 3, ORIGIN);
    await vi.runAllTimersAsync();
    const evals = await promise;

    // Cloud dit +30 POV Blanc = -30 POV Noirs (le trait).
    expect(evals![0].cp).toBe(-30);
    expect(evals![1].cp).toBe(-25);
  });

  it('cache le hit : deuxième navigation = zéro requête', async () => {
    const fetchSpy = mockFetch([{ status: 200, body: hit(WHITE_TO_MOVE) }]);

    const first = CloudEvalService.fetch(WHITE_TO_MOVE, 3, ORIGIN);
    await vi.runAllTimersAsync();
    await first;

    const second = CloudEvalService.fetch(WHITE_TO_MOVE, 3, ORIGIN);
    const evals = await second; // pas besoin de timers : hit mémoire immédiat

    expect(evals![0].depth).toBe(25);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('dédouble les appels concurrents sur un même FEN', async () => {
    const fetchSpy = mockFetch([{ status: 200, body: hit(WHITE_TO_MOVE) }]);

    const p1 = CloudEvalService.fetch(WHITE_TO_MOVE, 3, ORIGIN);
    const p2 = CloudEvalService.fetch(WHITE_TO_MOVE, 3, ORIGIN);
    await vi.runAllTimersAsync();
    const [a, b] = await Promise.all([p1, p2]);

    expect(a![0].cp).toBe(30);
    expect(b![0].cp).toBe(30);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('404 → null (position inconnue du nuage), refetch possible ensuite', async () => {
    const fetchSpy = mockFetch([{ status: 404 }]);
    const promise = CloudEvalService.fetch(WHITE_TO_MOVE, 3, ORIGIN);
    await vi.runAllTimersAsync();
    expect(await promise).toBeNull();

    // Un second essai repart (l'`awaiting` est retiré) — divergence assumée
    // avec lila qui garde `awaitingEval` à vie.
    const promise2 = CloudEvalService.fetch(WHITE_TO_MOVE, 3, ORIGIN);
    await vi.runAllTimersAsync();
    expect(await promise2).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('erreur réseau → null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const promise = CloudEvalService.fetch(WHITE_TO_MOVE, 3, ORIGIN);
    await vi.runAllTimersAsync();
    expect(await promise).toBeNull();
  });

  it('latest wins : naviguer sur un autre FEN résout l\'ancien à null et n\'envoie que le dernier', async () => {
    const fetchSpy = mockFetch([{ status: 200, body: hit(BLACK_TO_MOVE) }]);

    const old = CloudEvalService.fetch(WHITE_TO_MOVE, 3, ORIGIN);
    const latest = CloudEvalService.fetch(BLACK_TO_MOVE, 3, ORIGIN);

    await vi.runAllTimersAsync();
    expect(await old).toBeNull(); // jamais laissé suspendu
    const evals = await latest;
    expect(evals![0].fen).toBe(BLACK_TO_MOVE);

    // Seul le FEN le plus récent a été envoyé.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain(encodeURIComponent(BLACK_TO_MOVE));
    expect(fetchSpy.mock.calls[0][0]).not.toContain(encodeURIComponent(WHITE_TO_MOVE));
  });

  it('throttle : un second FEN part ≥700 ms après le premier envoi', async () => {
    const fetchSpy = mockFetch([
      { status: 200, body: hit(WHITE_TO_MOVE) },
      { status: 200, body: hit(BLACK_TO_MOVE) },
    ]);

    const p1 = CloudEvalService.fetch(WHITE_TO_MOVE, 3, ORIGIN);
    await vi.runAllTimersAsync(); // premier envoi immédiat (lastFetchAt=0)
    await p1;

    const p2 = CloudEvalService.fetch(BLACK_TO_MOVE, 3, ORIGIN);
    // Pas encore 700 ms : rien n'est parti.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(699);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await p2;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
