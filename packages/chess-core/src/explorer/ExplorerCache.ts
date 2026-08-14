export interface OpeningData {
  white: number;
  draws: number;
  black: number;
  moves: Array<{
    uci: string;
    san: string;
    white: number;
    draws: number;
    black: number;
    averageRating: number;
  }>;
  opening?: {
    eco: string;
    name: string;
  };
}

export class ExplorerCache {
  private cache: Map<string, { data: OpeningData; timestamp: number }> = new Map();
  private readonly maxAgeMs = 8 * 60 * 1000; // 8 minutes TTL
  private readonly maxSize = 4096;

  public get(fen: string): OpeningData | undefined {
    const entry = this.cache.get(fen);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > this.maxAgeMs) {
      this.cache.delete(fen);
      return undefined;
    }

    return entry.data;
  }

  public set(fen: string, data: OpeningData): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(fen, { data, timestamp: Date.now() });
  }
}
