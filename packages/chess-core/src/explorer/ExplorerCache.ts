export interface OpeningMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
  /** Grandmaster games only, exposed by the masters database. */
  averageRatingGm?: number;
  opening?: { eco: string; name: string };
}

export interface OpeningData {
  white: number;
  draws: number;
  black: number;
  moves: OpeningMove[];
  opening?: {
    eco: string;
    name: string;
  };
}

export type CacheCategory = 'positive' | 'negative' | 'no_data' | 'error';

export interface ExplorerQueryOptions {
  endpoint?: string;
  moves?: number;
  variant?: string;
  ratings?: string;
  since?: string;
  until?: string;
}

interface CacheEntry {
  data: OpeningData;
  timestamp: number;
  ttlMs: number;
  category: CacheCategory;
}

/**
 * Cache intelligent d'explorateur d'ouvertures (P2).
 *
 * Utilise une clé composite (position normalisée + paramètres d'interrogation)
 * et des durées de vie différenciées par catégorie de résultat.
 */
export class ExplorerCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly maxSize = 4096;

  public static readonly TTL_MS: Record<CacheCategory, number> = {
    positive: 30 * 60 * 1000, // 30 minutes (statistiques valides)
    negative: 15 * 60 * 1000, // 15 minutes (absence vérifiée / liste exhaustive)
    no_data: 10 * 60 * 1000,  // 10 minutes (position inconnue N_pos === 0)
    error: 10 * 1000,         // 10 secondes (échec technique temporaire)
  };

  /**
   * Normalise un FEN en ne conservant que les 4 champs positionnels invariants
   * (pièces, trait, droits de roque, case en-passant) pour que les transpositions
   * partagent automatiquement la même entrée de cache.
   */
  public static normalizeFen(fen: string): string {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) return fen.trim();
    return parts.slice(0, 4).join(' ');
  }

  /**
   * Construit une clé composite unique incluant la position et l'ensemble des
   * paramètres influençant les résultats de l'API.
   */
  public static buildKey(fen: string, options?: ExplorerQueryOptions): string {
    const posKey = this.normalizeFen(fen);
    const endpoint = options?.endpoint ?? 'masters';
    const moves = options?.moves ?? 12;
    const variant = options?.variant ?? 'standard';
    const ratings = options?.ratings ?? '';
    const since = options?.since ?? '';
    const until = options?.until ?? '';
    return [posKey, endpoint, moves, variant, ratings, since, until].join(':');
  }

  public get(keyOrFen: string, options?: ExplorerQueryOptions): OpeningData | undefined {
    const key = keyOrFen.includes(':') ? keyOrFen : ExplorerCache.buildKey(keyOrFen, options);
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > entry.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data;
  }

  public set(
    keyOrFen: string,
    data: OpeningData,
    category: CacheCategory = 'positive',
    options?: ExplorerQueryOptions
  ): void {
    const key = keyOrFen.includes(':') ? keyOrFen : ExplorerCache.buildKey(keyOrFen, options);
    const ttlMs = ExplorerCache.TTL_MS[category] ?? ExplorerCache.TTL_MS.positive;

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttlMs,
      category,
    });
  }

  public has(keyOrFen: string, options?: ExplorerQueryOptions): boolean {
    return this.get(keyOrFen, options) !== undefined;
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }
}
