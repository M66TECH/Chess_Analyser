import { EngineEvaluation } from '../events/GameEventBus';

export class EvalCache {
  private cache: Map<string, EngineEvaluation> = new Map();
  private readonly maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
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

  public get(fen: string): EngineEvaluation | undefined {
    const key = this.normalizeFen(fen);
    const evalResult = this.cache.get(key);
    if (evalResult) {
      // LRU refresh
      this.cache.delete(key);
      this.cache.set(key, evalResult);
    }
    return evalResult;
  }

  public set(fen: string, evaluation: EngineEvaluation): void {
    // Quality check (Lichess style): minimum depth or nodes
    // Let's assume we want depth >= 12 before caching
    if (evaluation.depth < 12) return;

    const key = this.normalizeFen(fen);
    if (this.cache.size >= this.maxSize) {
      // Remove oldest (first item in Map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, evaluation);
  }
}
