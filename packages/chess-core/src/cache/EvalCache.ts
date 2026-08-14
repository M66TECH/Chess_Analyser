import { EngineEvaluation } from '../events/GameEventBus';

export class EvalCache {
  private readonly dbName = 'ChessAnalyzerEvalDB';
  private readonly storeName = 'evals';
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor() {
    if (typeof window !== 'undefined' && window.indexedDB) {
      this.initDB();
    }
  }

  private initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
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
        reject('Error opening IndexedDB');
      };
    });

    return this.dbPromise;
  }

  /**
   * Normalizes a FEN by removing the halfmove and fullmove counters,
   * so that functionally identical positions share the same cache entry.
   */
  public normalizeFen(fen: string): string {
    const parts = fen.split(' ');
    // Keep pieces, turn, castling, en passant (first 4 parts)
    return parts.slice(0, 4).join(' ');
  }

  public async get(fen: string): Promise<EngineEvaluation | undefined> {
    if (!this.dbPromise) return undefined;

    try {
      const db = await this.dbPromise;
      const key = this.normalizeFen(fen);

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
    } catch (e) {
      return undefined;
    }
  }

  public async set(fen: string, evaluation: EngineEvaluation): Promise<void> {
    if (!this.dbPromise) return;
    
    // Quality check (Lichess style): minimum depth
    if (evaluation.depth < 14) return;

    try {
      const db = await this.dbPromise;
      const key = this.normalizeFen(fen);

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(evaluation, key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject();
      });
    } catch (e) {
      console.error('Failed to save eval to IndexedDB:', e);
    }
  }
}
