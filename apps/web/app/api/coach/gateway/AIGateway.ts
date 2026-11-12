import type {
  ProviderConfig,
  CompletionRequest,
  CompletionResult,
  ModelConfig,
} from '../registry/types';
import {
  PROVIDERS_REGISTRY,
  resolveKeysForProvider,
  resolveModelsForProvider,
} from '../registry/providers.config';
import type { IStateStore } from './IStateStore';
import { MemoryStateStore, maskKey } from './MemoryStateStore';
import { CircuitBreaker } from './CircuitBreaker';
import { HealthScorer } from './HealthScorer';

export interface AIGatewayOptions {
  providers?: ProviderConfig[];
  store?: IStateStore;
  maxNetworkAttempts?: number;
  defaultGlobalTimeoutMs?: number;
}

export class AIGateway {
  private providers: ProviderConfig[];
  private store: IStateStore;
  private circuitBreaker: CircuitBreaker;
  private maxNetworkAttempts: number;
  private defaultGlobalTimeoutMs: number;

  constructor(options: AIGatewayOptions = {}) {
    this.providers = options.providers ?? PROVIDERS_REGISTRY;
    this.store = options.store ?? new MemoryStateStore();
    this.circuitBreaker = new CircuitBreaker(this.store);
    this.maxNetworkAttempts = options.maxNetworkAttempts ?? 3;
    this.defaultGlobalTimeoutMs = options.defaultGlobalTimeoutMs ?? 12_000;
  }

  /**
   * Orchestre l'appel LLM avec scoring dynamique, rotation multi-clés,
   * respect strict du budget de 12s, et maximum 3 appels réseau.
   */
  public async complete(request: CompletionRequest): Promise<CompletionResult> {
    const globalTimeout = request.globalTimeoutMs ?? this.defaultGlobalTimeoutMs;
    const globalDeadline = Date.now() + globalTimeout;
    const clientSignal = request.clientSignal;

    // Si le client a déjà annulé la requête avant de commencer
    if (clientSignal?.aborted) {
      return {
        ok: false,
        error: 'Client aborted request before execution',
        failures: ['client_aborted'],
        attemptsCount: 0,
        remainingBudgetMs: 0,
      };
    }

    // 1. Classement dynamique des fournisseurs selon leur score de santé
    const rankedProviders = await this.rankProviders();
    if (rankedProviders.length === 0) {
      return {
        ok: false,
        error: 'No active AI providers available (check API keys in .env.local)',
        failures: ['no_providers_configured'],
        attemptsCount: 0,
        remainingBudgetMs: Math.max(0, globalDeadline - Date.now()),
      };
    }

    let networkAttempts = 0;
    const failures: string[] = [];

    // 2. Cascade ordonnée par score
    for (const provider of rankedProviders) {
      // Vérification du budget global : s'il reste moins de 1.5s, on arrête pour repli local
      const remainingBudgetMs = globalDeadline - Date.now();
      if (remainingBudgetMs < 1500) {
        failures.push(`budget_exhausted (remaining: ${remainingBudgetMs}ms)`);
        break;
      }

      // Si le nombre maximal d'appels réseau (3) est atteint
      if (networkAttempts >= this.maxNetworkAttempts) {
        failures.push(`max_network_attempts_reached (${this.maxNetworkAttempts})`);
        break;
      }

      // Si l'hôte du fournisseur est en cooldown temporaire (ex: suite à 5xx)
      if (await this.store.isHostInCooldown(provider.id)) {
        continue; // 0 ms, aucun appel réseau gaspillé
      }

      const keys = resolveKeysForProvider(provider);
      if (keys.length === 0) continue;

      const allModels = resolveModelsForProvider(provider);
      const availableModels = await this.filterAvailableModels(provider.id, allModels);
      if (availableModels.length === 0) continue;

      // On teste les modèles avec les clés saines du pool
      for (const modelConfig of availableModels) {
        // Boucle sur les clés saines du pool pour ce modèle
        while (networkAttempts < this.maxNetworkAttempts) {
          const remainingForCall = globalDeadline - Date.now();
          if (remainingForCall < 1500) {
            failures.push(`budget_exhausted (remaining: ${remainingForCall}ms)`);
            break;
          }
          if (clientSignal?.aborted) {
            failures.push('client_aborted_during_cascade');
            break;
          }

          // Si l'hôte vient d'être mis en cooldown (ex: 5xx), on ne le sollicite plus
          if (await this.store.isHostInCooldown(provider.id)) {
            break;
          }

          // Si le modèle vient d'être marqué indisponible (ex: 404 model_not_found), on passe au modèle suivant
          if (!(await this.store.isModelAvailable(provider.id, modelConfig.id))) {
            break;
          }

          // Sélection d'une clé saine via rotation atomique
          const healthyKey = await this.selectHealthyKeyAtomic(provider.id, keys);
          if (!healthyKey) {
            // Plus aucune clé saine pour ce fournisseur
            break;
          }

          networkAttempts += 1; // 1 appel réseau effectif
          const startTime = Date.now();

          try {
            const timeoutMs = Math.min(provider.timeoutMs ?? 8000, remainingForCall);
            const completion = await this.executeCall(
              provider,
              healthyKey,
              modelConfig,
              request,
              timeoutMs,
              clientSignal
            );

            const latencyMs = Date.now() - startTime;
            await this.store.recordMetrics(provider.id, latencyMs, true);

            this.logEvent({
              level: 'info',
              event: 'coach_completion_success',
              provider: provider.id,
              keyMasked: maskKey(healthyKey),
              model: modelConfig.id,
              latencyMs,
              attempts: networkAttempts,
            });

            return {
              ok: true,
              content: completion,
              modelUsed: `${provider.name}:${modelConfig.id}`,
              providerId: provider.id,
              latencyMs,
              attemptsCount: networkAttempts,
            };
          } catch (error: unknown) {
            const latencyMs = Date.now() - startTime;
            const isTimeout = error instanceof Error && error.name === 'TimeoutError';
            const isClientAbort = clientSignal?.aborted;

            if (isClientAbort) {
              return {
                ok: false,
                error: 'Client aborted request',
                failures: [...failures, 'client_aborted'],
                attemptsCount: networkAttempts,
                remainingBudgetMs: Math.max(0, globalDeadline - Date.now()),
              };
            }

            const failureReason = isTimeout ? 'timeout' : error instanceof Error ? error.message : 'unknown';
            failures.push(`${provider.name} (${modelConfig.id}): ${failureReason}`);

            this.logEvent({
              level: 'warn',
              event: 'coach_completion_failed',
              provider: provider.id,
              keyMasked: maskKey(healthyKey),
              model: modelConfig.id,
              latencyMs,
              error: failureReason,
              attempts: networkAttempts,
            });

            // Enregistre l'échec dans les métriques
            await this.store.recordMetrics(provider.id, latencyMs, false);

            // Si l'hôte ou le modèle est maintenant indisponible, on sort du while
            if (
              (await this.store.isHostInCooldown(provider.id)) ||
              !(await this.store.isModelAvailable(provider.id, modelConfig.id))
            ) {
              break;
            }

            // Si plus aucune autre clé saine n'est disponible pour ce provider, on sort
            let hasAnotherHealthyKey = false;
            for (const k of keys) {
              if (await this.circuitBreaker.isKeyAvailable(k)) {
                hasAnotherHealthyKey = true;
                break;
              }
            }
            if (!hasAnotherHealthyKey) {
              break;
            }
          }
        }
      }
    }

    return {
      ok: false,
      error: 'All coach providers unavailable or budget exceeded',
      failures,
      attemptsCount: networkAttempts,
      remainingBudgetMs: Math.max(0, globalDeadline - Date.now()),
    };
  }

  /**
   * Exécute un appel HTTP OpenAI-compatible vers l'endpoint du fournisseur.
   */
  private async executeCall(
    provider: ProviderConfig,
    key: string,
    modelConfig: ModelConfig,
    request: CompletionRequest,
    timeoutMs: number,
    clientSignal?: AbortSignal
  ): Promise<string> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    // Combine le signal client et le timeout
    const combinedSignal = clientSignal
      ? (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any?.([
          clientSignal,
          timeoutSignal,
        ]) ?? timeoutSignal
      : timeoutSignal;

    // Prise en compte du plancher de tokens pour les modèles à raisonnement
    const requestedTokens = request.maxTokens ?? 1200;
    const finalMaxTokens = modelConfig.maxTokensFloor
      ? Math.max(requestedTokens, modelConfig.maxTokensFloor)
      : requestedTokens;

    const res = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(provider.customHeaders ?? {}),
      },
      body: JSON.stringify({
        model: modelConfig.id,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: finalMaxTokens,
      }),
      signal: combinedSignal,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      await this.circuitBreaker.handleHttpFailure(provider.id, key, modelConfig.id, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        bodyText,
      });
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string; reasoning_content?: string };
        finish_reason?: string;
      }>;
    };

    const choice = data.choices?.[0];
    const content =
      choice?.message?.content?.trim() || choice?.message?.reasoning_content?.trim() || '';

    if (!content) {
      throw new Error('Empty response from model');
    }

    return content;
  }

  /**
   * Trie les fournisseurs actifs selon leur score de santé dynamique.
   */
  private async rankProviders(): Promise<ProviderConfig[]> {
    const active: Array<{ provider: ProviderConfig; score: number }> = [];

    for (const provider of this.providers) {
      if (provider.enabled === false) continue;
      const keys = resolveKeysForProvider(provider);
      if (keys.length === 0) continue;

      const metrics = await this.store.getMetrics(provider.id);
      const score = HealthScorer.calculateScore(provider, metrics);
      active.push({ provider, score });
    }

    active.sort((a, b) => b.score - a.score);
    return active.map(a => a.provider);
  }

  /**
   * Sélectionne de façon atomique la prochaine clé saine d'un pool.
   */
  private async selectHealthyKeyAtomic(
    providerId: string,
    keys: string[]
  ): Promise<string | null> {
    if (keys.length === 0) return null;

    const startIndex = await this.store.getNextKeyIndexAtomic(providerId, keys.length);

    for (let i = 0; i < keys.length; i++) {
      const idx = (startIndex + i) % keys.length;
      const candidate = keys[idx];
      const isAvailable = await this.circuitBreaker.isKeyAvailable(candidate);
      if (isAvailable) return candidate;
    }

    return null;
  }

  /**
   * Filtre les modèles disponibles (exclut les modèles confirmés 404).
   */
  private async filterAvailableModels(
    providerId: string,
    models: ModelConfig[]
  ): Promise<ModelConfig[]> {
    const available: ModelConfig[] = [];
    for (const model of models) {
      const isAvailable = await this.store.isModelAvailable(providerId, model.id);
      if (isAvailable) available.push(model);
    }
    return available;
  }

  private logEvent(event: { level: 'info' | 'warn' | 'error'; event: string; [key: string]: unknown }): void {
    const payload = {
      timestamp: new Date().toISOString(),
      component: 'AIGateway',
      ...event,
    };
    if (event.level === 'warn') {
      console.warn(`[AIGateway]`, JSON.stringify(payload));
    } else {
      console.log(`[AIGateway]`, JSON.stringify(payload));
    }
  }
}
