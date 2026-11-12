import { ExplorerCache, OpeningData, CacheCategory, ExplorerQueryOptions } from './ExplorerCache';
import type { OpeningMove } from './ExplorerCache';

interface RawOpeningMove extends OpeningMove {
  game?: unknown;
  opening?: { eco: string; name: string };
}

interface RawOpeningData {
  white: number;
  draws: number;
  black: number;
  moves: RawOpeningMove[];
  opening?: { eco: string; name: string } | null;
}

export interface OpeningFetchResult {
  data: OpeningData | null;
  /** Nom de l'ouverture atteinte, quand la base de données la connaît. */
  opening: { eco: string; name: string } | null;
}

export interface FetchOpeningOptions extends ExplorerQueryOptions {
  /** Signal d'annulation spécifique pour ce demandeur. */
  signal?: AbortSignal;
  /** Délai de temporisation avant émission (ms). Utile pour navigation rapide. */
  debounceMs?: number;
  /** Timeout réseau en ms (par défaut 10 000 ms). */
  timeoutMs?: number;
}

interface Subscriber {
  id: string;
  resolve: (res: OpeningFetchResult) => void;
  signal?: AbortSignal;
}

interface InFlightTask {
  key: string;
  abortController: AbortController;
  subscribers: Map<string, Subscriber>;
  promise: Promise<OpeningFetchResult>;
}

/**
 * Service d'accès à l'Opening Explorer de Lichess (P2).
 *
 * Fonctionnalités clés :
 * 1. File d'attente réseau séquentielle : respect strict de la politique Lichess (1 seule requête active à la fois).
 * 2. Gestion de l'erreur HTTP 429 avec prise en compte du header Retry-After.
 * 3. Déduplication des requêtes en vol avec gestion granulaire des abonnements et annulations indépendantes.
 * 4. Cache multi-catégories (positive, negative, no_data, error) avec normalisation EPD des positions.
 */
export class OpeningExplorer {
  private static cache = new ExplorerCache();

  /** Table des requêtes réseau en cours, indexée par clé composite. */
  private static inFlight = new Map<string, InFlightTask>();

  /** File d'attente séquentielle des requêtes à exécuter. */
  private static requestQueue: Array<() => Promise<void>> = [];
  private static isProcessingQueue = false;

  /** Horodatage jusqu'auquel les appels sont mis en pause suite à un HTTP 429. */
  private static rateLimitCooldownUntil = 0;

  private static subscriberSeq = 0;

  /** Réinitialise l'état statique (principalement pour les tests). */
  public static resetState(): void {
    for (const task of this.inFlight.values()) {
      task.abortController.abort();
    }
    this.inFlight.clear();
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.rateLimitCooldownUntil = 0;
    this.cache.clear();
  }

  /** Expose le cache sous-jacent (utilitaire de test). */
  public static getCache(): ExplorerCache {
    return this.cache;
  }

  /**
   * Récupère les données d'ouverture pour un FEN donné.
   */
  public static async fetch(fen: string, options?: FetchOpeningOptions): Promise<OpeningData | null> {
    const result = await this.fetchWithOpening(fen, options);
    return result.data;
  }

  /**
   * Récupère les données d'ouverture ainsi que le nom de l'ouverture / ECO.
   */
  public static async fetchWithOpening(
    fen: string,
    options?: FetchOpeningOptions
  ): Promise<OpeningFetchResult> {
    const key = ExplorerCache.buildKey(fen, options);

    // 1. Vérification dans le cache mémoire
    const cached = this.cache.get(key);
    if (cached) {
      return { data: cached, opening: this.openingOf(cached) };
    }

    // 2. Gestion du signal déjà avorté
    if (options?.signal?.aborted) {
      return { data: null, opening: null };
    }

    const subscriberId = `sub_${++this.subscriberSeq}`;

    // 3. Déduplication des requêtes en vol (In-Flight Task)
    let task = this.inFlight.get(key);

    if (task) {
      return new Promise<OpeningFetchResult>((resolve) => {
        const sub: Subscriber = { id: subscriberId, resolve, signal: options?.signal };
        task!.subscribers.set(subscriberId, sub);

        // Si ce demandeur spécifique annule son attente
        if (options?.signal) {
          options.signal.addEventListener(
            'abort',
            () => {
              if (task && task.subscribers.has(subscriberId)) {
                task.subscribers.delete(subscriberId);
                resolve({ data: null, opening: null });
                // Si plus aucun abonné ne s'intéresse à cette requête, on avorte la tâche sous-jacente
                if (task.subscribers.size === 0) {
                  task.abortController.abort();
                  this.inFlight.delete(key);
                }
              }
            },
            { once: true }
          );
        }
      });
    }

    // 4. Création d'une nouvelle tâche en vol
    const abortController = new AbortController();
    const subscribers = new Map<string, Subscriber>();

    const promise = new Promise<OpeningFetchResult>((resolve) => {
      subscribers.set(subscriberId, { id: subscriberId, resolve, signal: options?.signal });

      if (options?.signal) {
        options.signal.addEventListener(
          'abort',
          () => {
            if (subscribers.has(subscriberId)) {
              subscribers.delete(subscriberId);
              resolve({ data: null, opening: null });
              if (subscribers.size === 0) {
                abortController.abort();
                this.inFlight.delete(key);
              }
            }
          },
          { once: true }
        );
      }
    });

    task = {
      key,
      abortController,
      subscribers,
      promise,
    };
    this.inFlight.set(key, task);

    // 5. Enregistrement dans la file séquentielle
    const debounceMs = options?.debounceMs ?? 0;
    if (debounceMs > 0) {
      setTimeout(() => {
        if (!abortController.signal.aborted) {
          this.enqueueRequest(fen, key, task!, options);
        }
      }, debounceMs);
    } else {
      this.enqueueRequest(fen, key, task, options);
    }

    return promise;
  }

  /**
   * Enfile une tâche pour exécution séquentielle respectant les quotas Lichess.
   */
  private static enqueueRequest(
    fen: string,
    key: string,
    task: InFlightTask,
    options?: FetchOpeningOptions
  ): void {
    this.requestQueue.push(async () => {
      if (task.abortController.signal.aborted || task.subscribers.size === 0) {
        this.inFlight.delete(key);
        return;
      }

      // Respect du cooldown 429 si en cours
      const now = Date.now();
      if (now < this.rateLimitCooldownUntil) {
        const waitTime = this.rateLimitCooldownUntil - now;
        await new Promise((r) => setTimeout(r, waitTime));
      }

      try {
        const timeoutMs = options?.timeoutMs ?? 10000;
        const result = await this.executeFetch(fen, key, task.abortController.signal, timeoutMs);
        this.notifySubscribers(task, result);
      } catch {
        // En cas d'erreur ou d'annulation
        const result: OpeningFetchResult = { data: null, opening: null };
        this.cache.set(key, { white: 0, draws: 0, black: 0, moves: [] }, 'error');
        this.notifySubscribers(task, result);
      } finally {
        this.inFlight.delete(key);
      }
    });

    void this.processQueue();
  }

  /**
   * Traitement séquentiel de la file d'attente (1 seule requête active à la fois).
   */
  private static async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.requestQueue.length > 0) {
        const nextTask = this.requestQueue.shift();
        if (nextTask) {
          await nextTask();
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Exécute la requête HTTP réelle vers le proxy de l'API Lichess.
   */
  private static async executeFetch(
    fen: string,
    key: string,
    signal: AbortSignal,
    timeoutMs: number
  ): Promise<OpeningFetchResult> {
    const timeoutSignal = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
    const combinedSignal = timeoutSignal
      ? anySignal([signal, timeoutSignal])
      : signal;

    const url = `/api/explorer?fen=${encodeURIComponent(fen)}&moves=12`;
    let response: Response;

    try {
      response = await fetch(url, { signal: combinedSignal });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      this.cache.set(key, { white: 0, draws: 0, black: 0, moves: [] }, 'error');
      return { data: null, opening: null };
    }

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const retrySeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
        const cooldown = Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds : 60;
        this.rateLimitCooldownUntil = Date.now() + cooldown * 1000;
        console.warn(`Lichess Explorer HTTP 429 : pause de la file pendant ${cooldown}s`);
      }
      this.cache.set(key, { white: 0, draws: 0, black: 0, moves: [] }, 'error');
      return { data: null, opening: null };
    }

    const raw = (await response.json()) as RawOpeningData;
    return this.store(key, raw);
  }

  /**
   * Notifie l'ensemble des abonnés restants pour une tâche terminée.
   */
  private static notifySubscribers(task: InFlightTask, result: OpeningFetchResult): void {
    for (const sub of task.subscribers.values()) {
      try {
        sub.resolve(result);
      } catch {
        // Protection contre exceptions dans callbacks externes
      }
    }
    task.subscribers.clear();
  }

  /**
   * Enregistre le résultat dans le cache avec la catégorie appropriée et retourne le résultat formaté.
   */
  private static store(key: string, raw: RawOpeningData): OpeningFetchResult {
    const data: OpeningData = {
      white: raw.white ?? 0,
      draws: raw.draws ?? 0,
      black: raw.black ?? 0,
      moves: (raw.moves ?? []).map((m) => ({
        uci: m.uci,
        san: m.san,
        white: m.white ?? 0,
        draws: m.draws ?? 0,
        black: m.black ?? 0,
        averageRating: m.averageRating,
        opening: m.opening,
      })),
      opening: raw.opening ?? undefined,
    };

    const totalGames = data.white + data.draws + data.black;
    let category: CacheCategory = 'positive';

    if (totalGames === 0) {
      category = 'no_data';
    } else if (data.moves.length < 12) {
      category = 'negative'; // Exhaustif sans saturation
    } else {
      category = 'positive';
    }

    this.cache.set(key, data, category);
    return { data, opening: this.openingOf(data) };
  }

  private static openingOf(data: OpeningData): { eco: string; name: string } | null {
    if (data.opening) return data.opening;
    const firstWithOpening = data.moves?.find((m) => m.opening);
    if (firstWithOpening?.opening) return firstWithOpening.opening;
    return null;
  }
}

/**
 * Utilitaire de combinaison de signaux d'annulation (compatible avec navigateurs et Node.js).
 */
function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (!sig) continue;
    if (sig.aborted) {
      controller.abort();
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
