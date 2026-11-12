import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIGateway } from '../gateway/AIGateway';
import { MemoryStateStore, hashKey } from '../gateway/MemoryStateStore';
import { CircuitBreaker } from '../gateway/CircuitBreaker';
import { HealthScorer } from '../gateway/HealthScorer';
import type { ProviderConfig } from '../registry/types';

describe('AI Gateway & Circuit Breaker Architecture (Spécification v2)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.clearAllMocks();
  });

  const testProvider: ProviderConfig = {
    id: 'test-provider',
    name: 'TestProvider',
    baseUrl: 'https://test.api/v1/chat/completions',
    envKeyName: 'TEST_API_KEYS',
    defaultPriority: 1,
    timeoutMs: 5000,
    defaultModels: [{ id: 'model-a', profile: 'fast' }, { id: 'model-b', profile: 'fast' }],
  };

  it('Scénario 1 : Une clé qui renvoie 429 est mise en quarantaine avec Retry-After respecté', async () => {
    const store = new MemoryStateStore();
    const breaker = new CircuitBreaker(store);
    const key = 'test-key-429';
    const keyHash = hashKey(key);

    const headers = new Headers();
    headers.set('retry-after', '45'); // 45 secondes

    await breaker.handleHttpFailure('test-provider', key, 'model-a', {
      status: 429,
      headers,
      bodyText: 'Rate limit exceeded',
    });

    const isAvailable = await breaker.isKeyAvailable(key);
    expect(isAvailable).toBe(false);

    const state = await store.getKeyState(keyHash);
    expect(state?.isRevoked).toBe(false);
    expect(state?.cooldownUntil).toBeGreaterThan(Date.now() + 40_000);
  });

  it('Scénario 2 : Une clé qui renvoie 401 est révoquée définitivement', async () => {
    const store = new MemoryStateStore();
    const breaker = new CircuitBreaker(store);
    const key = 'invalid-api-key';
    const keyHash = hashKey(key);

    await breaker.handleHttpFailure('test-provider', key, 'model-a', {
      status: 401,
      bodyText: 'Invalid API Key',
    });

    const isAvailable = await breaker.isKeyAvailable(key);
    expect(isAvailable).toBe(false);

    const state = await store.getKeyState(keyHash);
    expect(state?.isRevoked).toBe(true);
    expect(state?.cooldownUntil).toBe(Infinity);
  });

  it('Scénario 3 : Modèle 404 désactivé UNIQUEMENT si model_not_found confirmé dans le JSON', async () => {
    const store = new MemoryStateStore();
    const breaker = new CircuitBreaker(store);

    // Cas 3A : 404 avec JSON explicite model_not_found -> désactivation confirmée
    await breaker.handleHttpFailure('test-provider', 'any-key', 'model-deprecated', {
      status: 404,
      bodyText: JSON.stringify({
        error: { code: 'model_not_found', message: 'The model model-deprecated does not exist.' },
      }),
    });
    expect(await store.isModelAvailable('test-provider', 'model-deprecated')).toBe(false);

    // Cas 3B : 404 générique non structuré (mauvais endpoint/URL) -> NE DOIT PAS désactiver le modèle
    await breaker.handleHttpFailure('test-provider', 'any-key', 'model-valid', {
      status: 404,
      bodyText: '<html>404 Not Found (bad path)</html>',
    });
    expect(await store.isModelAvailable('test-provider', 'model-valid')).toBe(true);
    // Mais l'hôte est en cooldown
    expect(await store.isHostInCooldown('test-provider')).toBe(true);
  });

  it('Scénario 4 : Fournisseur qui renvoie 503 pénalise l’hôte mais ne révoque aucune clé', async () => {
    const store = new MemoryStateStore();
    const breaker = new CircuitBreaker(store);
    const key = 'valid-key-on-failing-server';

    await breaker.handleHttpFailure('test-provider', key, 'model-a', {
      status: 503,
      statusText: 'Service Unavailable',
    });

    // L'hôte est en pause
    expect(await store.isHostInCooldown('test-provider')).toBe(true);

    // Mais la clé n'est pas révoquée et reste disponible
    expect(await breaker.isKeyAvailable(key)).toBe(true);
    const state = await store.getKeyState(hashKey(key));
    expect(state?.isRevoked ?? false).toBe(false);
  });

  it('Scénario 5 : Rotation atomique équitable sans collision sous requêtes simultanées', async () => {
    const store = new MemoryStateStore();
    const poolSize = 3;

    // Simulation de 6 requêtes concurrentes en parallèle
    const results = await Promise.all([
      store.getNextKeyIndexAtomic('groq', poolSize),
      store.getNextKeyIndexAtomic('groq', poolSize),
      store.getNextKeyIndexAtomic('groq', poolSize),
      store.getNextKeyIndexAtomic('groq', poolSize),
      store.getNextKeyIndexAtomic('groq', poolSize),
      store.getNextKeyIndexAtomic('groq', poolSize),
    ]);

    expect(results).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('Scénario 6 : Scoring dynamique favorise le fournisseur avec la meilleure latence et le plus faible taux d’erreur', () => {
    const configP1: ProviderConfig = { ...testProvider, id: 'prov-1', defaultPriority: 1 };
    const configP2: ProviderConfig = { ...testProvider, id: 'prov-2', defaultPriority: 2 };

    // Prov 1 a une latence de 300ms et 100% de succès
    const score1 = HealthScorer.calculateScore(configP1, {
      totalCalls: 10,
      successCalls: 10,
      totalLatencyMs: 3000,
      avgLatencyMs: 300,
      consecutive5xx: 0,
      hostCooldownUntil: 0,
    });

    // Prov 2 a une latence de 2000ms et des erreurs 5xx consécutives
    const score2 = HealthScorer.calculateScore(configP2, {
      totalCalls: 10,
      successCalls: 7,
      totalLatencyMs: 14000,
      avgLatencyMs: 2000,
      consecutive5xx: 2,
      hostCooldownUntil: 0,
    });

    // Prov 1 doit avoir un score largement supérieur
    expect(score1).toBeGreaterThan(score2);
  });

  it('Scénario 7 : Respect strict du plafond de 3 tentatives réseau', async () => {
    process.env.TEST_API_KEYS = 'key1';
    process.env.TEST_API_KEYS_2 = 'key2';
    process.env.TEST_API_KEYS_3 = 'key3';
    process.env.TEST_API_KEYS_4 = 'key4';

    const p1: ProviderConfig = { ...testProvider, id: 'prov-1', envKeyName: 'TEST_API_KEYS', defaultPriority: 1 };
    const p2: ProviderConfig = { ...testProvider, id: 'prov-2', envKeyName: 'TEST_API_KEYS_2', defaultPriority: 2 };
    const p3: ProviderConfig = { ...testProvider, id: 'prov-3', envKeyName: 'TEST_API_KEYS_3', defaultPriority: 3 };
    const p4: ProviderConfig = { ...testProvider, id: 'prov-4', envKeyName: 'TEST_API_KEYS_4', defaultPriority: 4 };

    // Mock fetch qui échoue à chaque fois
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Error',
      text: async () => 'Server error',
    });

    const gateway = new AIGateway({
      providers: [p1, p2, p3, p4],
      maxNetworkAttempts: 3,
      defaultGlobalTimeoutMs: 12_000,
    });

    const result = await gateway.complete({
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.ok).toBe(false);
    expect(result.attemptsCount).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3); // Exactement 3 appels réseau (p1, p2, p3 - puis arrêt)
  });

  it('Scénario 8 : Arrêt immédiat de la cascade si budget restant < 1.5s', async () => {
    process.env.TEST_API_KEYS = 'key1';

    // Requête avec un budget de 1000ms (< 1500ms)
    const gateway = new AIGateway({
      providers: [testProvider],
      maxNetworkAttempts: 3,
    });

    const result = await gateway.complete({
      messages: [{ role: 'user', content: 'hello' }],
      globalTimeoutMs: 1000, // Inférieur au seuil de sécurité de 1500ms
    });

    expect(result.ok).toBe(false);
    expect(result.attemptsCount).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled(); // 0 ms, aucun appel réseau gaspillé
  });

  it('Scénario 9 : Annulation immédiate via clientSignal (AbortSignal)', async () => {
    process.env.TEST_API_KEYS = 'key1';

    const controller = new AbortController();
    controller.abort(); // Le client a déjà fermé l'onglet

    const gateway = new AIGateway({
      providers: [testProvider],
    });

    const result = await gateway.complete({
      messages: [{ role: 'user', content: 'hello' }],
      clientSignal: controller.signal,
    });

    expect(result.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
