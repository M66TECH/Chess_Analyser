import { ExplorerCache, OpeningData } from './ExplorerCache';
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
  /** Name of the opening reached *by* the last move, when the database knows it. */
  opening: { eco: string; name: string } | null;
}

export class OpeningExplorer {
  private static cache = new ExplorerCache();
  private static abortController: AbortController | null = null;
  private static requestTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Fetches opening data for a given FEN from the Lichess masters database.
   * Debounced 250 ms, cancels the previous in-flight request.
   */
  public static async fetch(fen: string): Promise<OpeningData | null> {
    const result = await this.fetchWithOpening(fen);
    return result.data;
  }

  /**
   * Same as fetch(), but also reports the opening name that the explorer
   * attaches to the position. At the starting position Lichess returns
   * `opening: null`; the ECO name is then carried by the moves themselves.
   */
  public static async fetchWithOpening(fen: string): Promise<OpeningFetchResult> {
    const cached = this.cache.get(fen);
    if (cached) {
      return { data: cached, opening: this.openingOf(cached) };
    }

    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    return new Promise((resolve) => {
      if (this.requestTimeout) clearTimeout(this.requestTimeout);

      this.requestTimeout = setTimeout(async () => {
        try {
          const url = `/api/explorer?fen=${encodeURIComponent(fen)}&moves=12`;
          const response = await fetch(url, { signal });

          if (!response.ok) {
            if (response.status === 429) {
              console.warn('Lichess Explorer rate limited (429), retrying once in 1s');
              setTimeout(() => {
                fetch(url, { signal })
                  .then(async r => {
                    if (!r.ok) {
                      resolve({ data: null, opening: null });
                      return;
                    }
                    resolve(this.store(fen, (await r.json()) as RawOpeningData));
                  })
                  .catch(err => {
                    if (err instanceof Error && err.name !== 'AbortError') {
                      console.error('Lichess Explorer retry error:', err);
                    }
                    resolve({ data: null, opening: null });
                  });
              }, 1000);
              return;
            }
            resolve({ data: null, opening: null });
            return;
          }

          resolve(this.store(fen, (await response.json()) as RawOpeningData));
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            console.error('Lichess Explorer error:', error);
          }
          resolve({ data: null, opening: null });
        }
      }, 250);
    });
  }

  private static store(fen: string, raw: RawOpeningData): OpeningFetchResult {
    const data: OpeningData = {
      white: raw.white ?? 0,
      draws: raw.draws ?? 0,
      black: raw.black ?? 0,
      moves: (raw.moves ?? []).map(m => ({
        uci: m.uci,
        san: m.san,
        white: m.white ?? 0,
        draws: m.draws ?? 0,
        black: m.black ?? 0,
        averageRating: m.averageRating,
      })),
      opening: raw.opening ?? undefined,
    };
    this.cache.set(fen, data);
    return { data, opening: this.openingOf(data) };
  }

  /**
   * The position itself has no name at move 1, so fall back to the most played
   * move's opening: that is the line the position leads into.
   */
  private static openingOf(data: OpeningData): { eco: string; name: string } | null {
    if (data.opening) return data.opening;
    return null;
  }
}
