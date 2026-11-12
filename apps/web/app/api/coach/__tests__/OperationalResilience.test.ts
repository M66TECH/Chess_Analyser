import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AIGateway } from '../gateway/AIGateway';
import { MemoryStateStore, hashKey } from '../gateway/MemoryStateStore';
import { CircuitBreaker } from '../gateway/CircuitBreaker';
import type { ProviderConfig } from '../registry/types';

describe('Vérifications de Robustesse Opérationnelle (5 Piliers)', () => {
  const testDir = path.join(process.cwd(), '.test-resilience');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignorer si verrouillé
    }
  });

  it('1. Persistance des clés révoquées après "redémarrage" (nouvelle instance du store)', async () => {
    const revokedKey = 'gsk_leaked_key_compromised_999';
    const keyHash = hashKey(revokedKey);

    // Étape 1 : Le serveur tourne (instance 1) et reçoit un 401
    const storeInstance1 = new MemoryStateStore(testDir);
    const breaker1 = new CircuitBreaker(storeInstance1);
    await breaker1.handleHttpFailure('groq', revokedKey, 'qwen', {
      status: 401,
      bodyText: '{"error":{"message":"Invalid API key"}}',
    });

    expect(await breaker1.isKeyAvailable(revokedKey)).toBe(false);

    // Étape 2 : Le serveur "redémarre" -> nouvelle instance complète du store sans mémoire partagée
    const storeInstance2 = new MemoryStateStore(testDir);
    const breaker2 = new CircuitBreaker(storeInstance2);

    // Étape 3 : La clé révoquée doit rester immédiatement révoquée sans aucun appel réseau
    const isAvailableAfterRestart = await breaker2.isKeyAvailable(revokedKey);
    expect(isAvailableAfterRestart).toBe(false);

    const state = await storeInstance2.getKeyState(keyHash);
    expect(state?.isRevoked).toBe(true);
    expect(state?.cooldownUntil).toBe(Infinity);
  });

  it('2. Concurrence élevée : 20 requêtes simultanées sans collision de curseur', async () => {
    const store = new MemoryStateStore(testDir);
    const poolSize = 5; // 5 clés dans le pool

    // Lance 20 appels simultanés en Promise.all
    const promises = Array.from({ length: 20 }, () =>
      store.getNextKeyIndexAtomic('tokenharbor', poolSize)
    );
    const indices = await Promise.all(promises);

    expect(indices.length).toBe(20);
    // Vérifie que chaque index [0..4] est attribué exactement 4 fois (distribution parfaite)
    const counts = [0, 0, 0, 0, 0];
    for (const idx of indices) {
      counts[idx] += 1;
    }
    expect(counts).toEqual([4, 4, 4, 4, 4]);
  });

  it('3. Cascade sous quotas réels : bascule intelligente de 429 (Retry-After) vers 402 vers clé saine', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    const key1 = 'key-quota-429';
    const key2 = 'key-quota-402';
    const key3 = 'key-healthy-success';

    process.env.TEST_KEYS_CASCADE = `${key1},${key2},${key3}`;

    const cascadeProvider: ProviderConfig = {
      id: 'cascade-prov',
      name: 'CascadeProvider',
      baseUrl: 'https://cascade.test/v1/chat/completions',
      envKeyName: 'TEST_KEYS_CASCADE',
      defaultPriority: 1,
      defaultModels: [{ id: 'fast-model', profile: 'fast' }],
    };

    // Appel 1 : key1 renvoie 429
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'retry-after': '30' }),
      text: async () => 'Rate limit exceeded',
    });

    // Appel 2 : key2 renvoie 402
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      statusText: 'Payment Required',
      headers: new Headers(),
      text: async () => 'Credits depleted',
    });

    // Appel 3 : key3 réussit !
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        choices: [{ message: { content: 'Excellente décision tactique : le cavalier contrôle d5.' } }],
      }),
    });

    const store = new MemoryStateStore(testDir);
    const gateway = new AIGateway({
      providers: [cascadeProvider],
      store,
      maxNetworkAttempts: 3,
    });

    const result = await gateway.complete({
      messages: [{ role: 'user', content: 'Analyse ce coup' }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe('Excellente décision tactique : le cavalier contrôle d5.');
      expect(result.attemptsCount).toBe(3);
    }

    // Vérifie que key1 est en cooldown 30s et key2 en quarantaine 1h
    const breaker = new CircuitBreaker(store);
    expect(await breaker.isKeyAvailable(key1)).toBe(false);
    expect(await breaker.isKeyAvailable(key2)).toBe(false);

    // Une requête suivante sautera key1 et key2 en 0ms pour appeler directement key3
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        choices: [{ message: { content: 'Deuxième réponse instantanée sans gaspiller de requête réseau.' } }],
      }),
    });

    const result2 = await gateway.complete({
      messages: [{ role: 'user', content: 'Coup suivant' }],
    });

    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.attemptsCount).toBe(1); // 1 seul appel réseau direct à key3 !
    }
  });

  it('4. Format de réponse du Coach strictement compatible avec le contrat RiverAPI', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    process.env.TEST_KEY_COACH = 'valid-coach-key';
    const coachProvider: ProviderConfig = {
      id: 'coach-prov',
      name: 'Groq',
      baseUrl: 'https://groq.test/v1/chat/completions',
      envKeyName: 'TEST_KEY_COACH',
      defaultPriority: 1,
      defaultModels: [{ id: 'qwen/qwen3.8-27b', profile: 'fast' }],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: '### Analyse du coup\nLe coup **e4** prend le contrôle immédiat du centre et ouvre les diagonales pour le fou et la dame.',
          },
        }],
      }),
    });

    const gateway = new AIGateway({
      providers: [coachProvider],
    });

    const result = await gateway.complete({
      messages: [{ role: 'user', content: 'Explique e4' }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.content).toBe('string');
      expect(result.content).toContain('### Analyse du coup');
      expect(result.modelUsed).toBe('Groq:qwen/qwen3.8-27b');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});
