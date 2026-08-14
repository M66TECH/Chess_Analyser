import { ExplorerCache, OpeningData } from './ExplorerCache';

export class OpeningExplorer {
  private static cache = new ExplorerCache();
  private static abortController: AbortController | null = null;
  private static requestTimeout: NodeJS.Timeout | null = null;

  /**
   * Fetches opening data for a given FEN from lichess explorer API.
   * Uses a debounced fetch with an AbortController to cancel previous requests.
   */
  public static async fetch(fen: string): Promise<OpeningData | null> {
    const cached = this.cache.get(fen);
    if (cached) return cached;

    // Cancel previous request if any
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    return new Promise((resolve) => {
      if (this.requestTimeout) clearTimeout(this.requestTimeout);

      // Debounce 250ms
      this.requestTimeout = setTimeout(async () => {
        try {
          // masters database is usually more theoretical
          const url = `/api/explorer?fen=${encodeURIComponent(fen)}&moves=5`;
          const response = await fetch(url, { signal });
          
          if (!response.ok) {
            if (response.status === 429) {
              console.warn('Lichess Explorer Rate Limited (429)');
            }
            resolve(null);
            return;
          }

          const data: OpeningData = await response.json();
          this.cache.set(fen, data);
          resolve(data);
        } catch (error: any) {
          if (error.name !== 'AbortError') {
            console.error('Lichess Explorer error:', error);
          }
          resolve(null);
        }
      }, 250);
    });
  }
}
