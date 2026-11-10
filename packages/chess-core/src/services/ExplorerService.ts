import { LocalMode } from './LocalMode';

export interface MoveStats {
  uci: string;
  san: string;
}

export interface OpeningMoveStats extends MoveStats {
  white: number;
  black: number;
  draws: number;
}

export interface OpeningExplorerResult {
  isOpening: true;
  white: number;
  black: number;
  draws: number;
  moves: OpeningMoveStats[];
}

export interface TablebaseMoveStats extends MoveStats {
  dtz?: number;
  dtm?: number;
  category: string; // 'loss', 'draw', 'win', etc.
}

export interface TablebaseData {
  tablebase: true;
  category: string;
  moves: TablebaseMoveStats[];
}

export type ExplorerResult = OpeningExplorerResult | TablebaseData | null;

export class ExplorerService {
  /**
   * Cache mémoire partagé. Sans lui, chaque `PositionChanged` déclenchait une
   * requête (page) en plus de celle du pipeline (`OpeningExplorer`) pour la
   * même position : deux allers-retours réseau et deux caches divergents.
   * TTL 10 min, plafond 2048 entrées.
   */
  private static cache = new Map<string, { data: ExplorerResult; at: number }>();
  private static readonly TTL_MS = 10 * 60 * 1000;
  private static readonly MAX_ENTRIES = 2048;
  /** Requêtes en vol, pour dédoublonner les appels concurrents. */
  private static inflight = new Map<string, Promise<ExplorerResult>>();

  private static cacheKey(fen: string): string {
    // Même normalisation que `EvalCache` : le compteur de coups ne change
    // pas la position pour l'explorateur.
    return fen.split(' ').slice(0, 4).join(' ');
  }

  /**
   * Counts the number of pieces on the board from a FEN string.
   */
  public static countPieces(fen: string): number {
    const boardPart = fen.split(' ')[0];
    let count = 0;
    for (let i = 0; i < boardPart.length; i++) {
      const char = boardPart[i];
      if (/[prnbqkPRNBQK]/.test(char)) {
        count++;
      }
    }
    return count;
  }

  public static async fetch(fen: string): Promise<ExplorerResult> {
    const key = this.cacheKey(fen);

    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.TTL_MS) {
      return cached.data;
    }

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = this.fetchRemote(fen)
      .then(data => {
        if (data) {
          if (this.cache.size >= this.MAX_ENTRIES) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
          }
          this.cache.set(key, { data, at: Date.now() });
        }
        return data;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  private static async fetchRemote(fen: string): Promise<ExplorerResult> {
    // Mode local strict : aucune position ne quitte le navigateur.
    if (!LocalMode.allowRemote('explorer-service')) return null;

    const pieces = this.countPieces(fen);

    try {
      // Syzygy for 7 pieces or less
      if (pieces <= 7) {
        const url = `/api/tablebase?fen=${encodeURIComponent(fen)}`;
        const res = await globalThis.fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        const data = await res.json();
        return {
          tablebase: true,
          ...data
        } as TablebaseData;
      } else {
        // Opening Explorer for > 7 pieces
        const url = `/api/explorer?fen=${encodeURIComponent(fen)}&moves=12&topGames=0`;
        const res = await globalThis.fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        const data = await res.json();
        return {
          isOpening: true,
          ...data
        } as OpeningExplorerResult;
      }
    } catch (e) {
      console.error('[ExplorerService] Failed to fetch:', e);
      return null;
    }
  }

  /** Vide le cache (reset de partie, tests). */
  public static clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}
