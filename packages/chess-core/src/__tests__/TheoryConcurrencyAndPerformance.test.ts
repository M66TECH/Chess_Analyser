import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpeningExplorer } from '../explorer/OpeningExplorer';
import { ExplorerCache } from '../explorer/ExplorerCache';

describe('Theory Concurrency, Cache & Performance (P2)', () => {
  beforeEach(() => {
    OpeningExplorer.resetState();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    OpeningExplorer.resetState();
    vi.restoreAllMocks();
  });

  it('1. Deux positions différentes simultanées : résultats correctement associés', async () => {
    const fenA = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const fenB = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';

    let fetchCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      fetchCount++;
      const isFenA = url.includes(encodeURIComponent(fenA));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          white: isFenA ? 1000 : 800,
          draws: 500,
          black: 300,
          moves: [
            { uci: isFenA ? 'c7c5' : 'g8f6', san: isFenA ? 'c5' : 'Nf6', white: 500, draws: 250, black: 150 },
          ],
          opening: { eco: isFenA ? 'B20' : 'A45', name: isFenA ? 'Sicilian' : 'Indian' },
        }),
      } as Response;
    });

    // Lancement simultané des deux requêtes
    const [resA, resB] = await Promise.all([
      OpeningExplorer.fetchWithOpening(fenA),
      OpeningExplorer.fetchWithOpening(fenB),
    ]);

    expect(fetchCount).toBe(2);
    expect(resA.opening?.eco).toBe('B20');
    expect(resA.data?.white).toBe(1000);
    expect(resB.opening?.eco).toBe('A45');
    expect(resB.data?.white).toBe(800);
  });

  it('2. Déduplication en vol (In-Flight) : 10 abonnés simultanés déclenchent 1 seule requête', async () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    let networkCallCount = 0;

    global.fetch = vi.fn().mockImplementation(async () => {
      networkCallCount++;
      // Petite latence pour simuler le vol réseau
      await new Promise((r) => setTimeout(r, 15));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          white: 1000,
          draws: 500,
          black: 500,
          moves: [{ uci: 'c7c5', san: 'c5', white: 500, draws: 250, black: 250 }],
          opening: { eco: 'B20', name: 'Sicilian' },
        }),
      } as Response;
    });

    // 10 demandeurs concurrents pour la même position
    const promises = Array.from({ length: 10 }, () => OpeningExplorer.fetchWithOpening(fen));
    const results = await Promise.all(promises);

    expect(networkCallCount).toBe(1); // Exactement 1 seul appel réseau !
    for (const r of results) {
      expect(r.data?.white).toBe(1000);
      expect(r.opening?.eco).toBe('B20');
    }
  });

  it('3. Annulation isolée : 1 demandeur annule, les 9 autres reçoivent le résultat', async () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    let networkCallCount = 0;

    global.fetch = vi.fn().mockImplementation(async () => {
      networkCallCount++;
      await new Promise((r) => setTimeout(r, 30));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          white: 600,
          draws: 200,
          black: 200,
          moves: [],
          opening: null,
        }),
      } as Response;
    });

    const abortController = new AbortController();

    // Le 1er demandeur s'enregistre avec son propre signal d'annulation
    const cancelledPromise = OpeningExplorer.fetchWithOpening(fen, { signal: abortController.signal });

    // 9 autres demandeurs s'enregistrent sans annulation
    const otherPromises = Array.from({ length: 9 }, () => OpeningExplorer.fetchWithOpening(fen));

    // Annulation immédiate du 1er demandeur
    abortController.abort();

    const cancelledRes = await cancelledPromise;
    expect(cancelledRes.data).toBeNull(); // Le demandeur annulé reçoit null

    const otherResults = await Promise.all(otherPromises);
    expect(networkCallCount).toBe(1); // Le réseau a continué pour les 9 autres
    for (const res of otherResults) {
      expect(res.data?.white).toBe(600); // Tous les autres reçoivent la donnée
    }
  });

  it('4. Clé composite : options différentes produisent des entrées distinctes', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

    const keyMasters = ExplorerCache.buildKey(fen, { endpoint: 'masters', moves: 12 });
    const keyLichess = ExplorerCache.buildKey(fen, { endpoint: 'lichess', moves: 12 });
    const keyFewMoves = ExplorerCache.buildKey(fen, { endpoint: 'masters', moves: 5 });

    expect(keyMasters).not.toBe(keyLichess);
    expect(keyMasters).not.toBe(keyFewMoves);
  });

  it('5. Normalisation EPD : deux FEN avec numéros de coup différents partagent le même cache', () => {
    const fenMove1 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const fenMove5 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 3 5';

    const key1 = ExplorerCache.buildKey(fenMove1);
    const key2 = ExplorerCache.buildKey(fenMove5);

    expect(key1).toBe(key2); // Même clé composite EPD !
  });

  it('6. Gestion HTTP 429 et Retry-After', async () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    let attempts = 0;

    global.fetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '1' }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ white: 50, draws: 25, black: 25, moves: [] }),
      } as Response;
    });

    const res = await OpeningExplorer.fetchWithOpening(fen);
    // Première tentative a rencontré 429 -> retour propre sans crash
    expect(res.data).toBeNull();
  });

  it('7. Nettoyage après échec réseau : aucune promesse bloquée', async () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

    global.fetch = vi.fn().mockRejectedValue(new Error('Erreur de connexion'));

    const res = await OpeningExplorer.fetchWithOpening(fen);
    expect(res.data).toBeNull();

    // Une nouvelle tentative peut être soumise immédiatement sans rester bloquée
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ white: 100, draws: 50, black: 50, moves: [] }),
    } as Response);

    const cache = OpeningExplorer.getCache();
    cache.clear(); // Efface le cache d'erreur pour tester la réactivité
    const res2 = await OpeningExplorer.fetchWithOpening(fen);
    expect(res2.data?.white).toBe(100);
  });

  it('8. Benchmark Performance : Mesure comparative de latence et déduplication', async () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

    global.fetch = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          white: 5000,
          draws: 2000,
          black: 3000,
          moves: [{ uci: 'c7c5', san: 'c5', white: 2000, draws: 1000, black: 1000 }],
        }),
      } as Response;
    });

    // Mesure 1 : Premier appel (Cache froid)
    const t0 = performance.now();
    await OpeningExplorer.fetchWithOpening(fen);
    const coldDuration = performance.now() - t0;

    // Mesure 2 : 100 lectures consécutives en cache chaud
    const warmLatencies: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await OpeningExplorer.fetchWithOpening(fen);
      warmLatencies.push(performance.now() - start);
    }

    warmLatencies.sort((a, b) => a - b);
    const p50 = warmLatencies[Math.floor(warmLatencies.length * 0.5)];
    const p95 = warmLatencies[Math.floor(warmLatencies.length * 0.95)];

    expect(coldDuration).toBeGreaterThan(15); // A traversé le mock réseau
    expect(p50).toBeLessThan(5);              // Cache hit immédiat
    expect(p95).toBeLessThan(10);             // P95 très stable
  });
});
