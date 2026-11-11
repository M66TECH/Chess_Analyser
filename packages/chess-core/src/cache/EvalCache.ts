import { EngineEvaluation } from '../events/GameEventBus';

export class EvalCache {
  /**
   * Version du schéma de stockage. À incrémenter dès qu'une convention
   * d'évaluation change (ex. normalisation du POV) : les entrées d'une autre
   * version sont considérées invalides et purgées, sinon des scores faux
   * réapparaîtraient après une mise à jour du code.
   *
   * Historique :
   * - v1 : `normalize()` ne retournait le POV Blanc que pour les mats, le cp
   *        restait en POV trait → toutes les entrées des coups Noirs sont
   *        fausses.
   * - v2 : cp et mat normalisés en POV Blanc de façon uniforme.
   */
  private readonly schemaVersion = 2;
  private readonly dbName = 'ChessAnalyzerEvalDB';
  private readonly storeName = 'evals';
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  /**
   * Fallback used when IndexedDB is unavailable (server rendering, tests, private
   * browsing): without it every `get()` misses and the pipeline loses the
   * pre-move evaluation, which breaks bestMove/classification.
   */
  private readonly memory: Map<string, EngineEvaluation> = new Map();
  /** Minimum depth for an evaluation to be considered reliable enough to cache. */
  private readonly minDepth = 14;

  constructor() {
    if (typeof window !== 'undefined' && window.indexedDB) {
      this.initDB();
    }
  }

  private initDB(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event);
        // Never reject: callers await this promise and a rejection would surface
        // as an unhandled error. The in-memory cache keeps the app working.
        this.dbPromise = null;
        resolve(null);
      };
    });

    return this.dbPromise;
  }

  /**
   * Normalizes a FEN by removing the fullmove counter only, so that functionally
   * identical positions share the same cache entry. The halfmove counter is kept
   * to avoid conflating positions that differ by the 50-move rule (3-fold, etc.).
   * Le préfixe de version invalide automatiquement les entrées d'un ancien
   * schéma (voir `schemaVersion`).
   */
  public normalizeFen(fen: string): string {
    const parts = fen.split(' ');
    // Keep pieces, turn, castling, en passant and halfmove clock (first 5 parts)
    return `v${this.schemaVersion}|${parts.slice(0, 5).join(' ')}`;
  }

  public async get(fen: string): Promise<EngineEvaluation | undefined> {
    const key = this.normalizeFen(fen);
    const fromMemory = this.memory.get(key);
    if (fromMemory) return fromMemory;

    if (!this.dbPromise) return undefined;

    try {
      const db = await this.dbPromise;
      if (!db) return undefined;

      return new Promise((resolve) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        request.onsuccess = (event) => {
          resolve((event.target as IDBRequest).result as EngineEvaluation | undefined);
        };

        request.onerror = () => {
          resolve(undefined);
        };
      });
    } catch {
      return undefined;
    }
  }

  public async set(fen: string, evaluation: EngineEvaluation): Promise<void> {
    // Quality check (Lichess style): minimum depth
    if (evaluation.depth < this.minDepth) return;

    const key = this.normalizeFen(fen);
    const existing = this.memory.get(key);
    // Garde de profondeur : ne pas écraser une évaluation plus profonde (sauf si un mat est trouvé)
    if (existing && existing.depth > evaluation.depth && typeof evaluation.mate !== 'number') {
      return;
    }

    this.memory.set(key, evaluation);
    if (this.memory.size > 4096) {
      const oldest = this.memory.keys().next().value;
      if (oldest !== undefined) this.memory.delete(oldest);
    }

    if (!this.dbPromise) return;

    try {
      const db = await this.dbPromise;
      if (!db) return;

      return new Promise((resolve) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(evaluation, key);

        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      });
    } catch (e) {
      console.error('Failed to save eval to IndexedDB:', e);
    }
  }
}
