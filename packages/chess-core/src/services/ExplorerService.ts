export interface MoveStats {
  uci: string;
  san: string;
}

export interface OpeningMoveStats extends MoveStats {
  white: number;
  black: number;
  draws: number;
}

export interface OpeningData {
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

export type ExplorerResult = OpeningData | TablebaseData | null;

export class ExplorerService {
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
    const pieces = this.countPieces(fen);

    try {
      // Syzygy for 7 pieces or less
      if (pieces <= 7) {
        const url = `/api/tablebase?fen=${encodeURIComponent(fen)}`;
        const res = await globalThis.fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return {
          tablebase: true,
          ...data
        } as TablebaseData;
      } else {
        // Opening Explorer for > 7 pieces
        const url = `/api/explorer?fen=${encodeURIComponent(fen)}&moves=12&topGames=0`;
        const res = await globalThis.fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return {
          isOpening: true,
          ...data
        } as OpeningData;
      }
    } catch (e) {
      console.error('[ExplorerService] Failed to fetch:', e);
      return null;
    }
  }
}
