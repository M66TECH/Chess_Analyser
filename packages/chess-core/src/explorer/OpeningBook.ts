import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import type { OpeningData, OpeningMove } from './ExplorerCache';

export interface BookMove {
  /** Move in UCI, ready for MoveManager.playMove()/chessground. */
  uci: string;
  /** Move in SAN, ready for display. */
  san: string;
  /** Share of the games (0..1) in which humans played this move. */
  frequency: number;
  /** Number of games, authoritative for theory detection. */
  games: number;
  /** Score for the side to move, 0..1 (1 = that side wins every game). */
  score: number;
}

const MIN_GAMES = 5;
/**
 * Popularity gap within which the practical score decides instead of raw
 * frequency. Kept small on purpose: theory is defined by what humans actually
 * play, the score only separates near-identical candidates.
 */
const MAX_FREQUENCY_GAP = 0.1;

/**
 * Derive the "human" theory moves of a position from a Lichess explorer
 * response.
 *
 * Stockfish judges positions with perfect play; humans follow lines that are
 * statistically proven. This turns the explorer data into a ranked list the
 * pipeline can trust more than the engine's first PV inside the opening.
 */
export class OpeningBook {
  /**
   * Converts the explorer moves to UCI, resolving SAN when the database only
   * provides SAN (the masters endpoint does). Returns [] when the FEN cannot be
   * parsed rather than throwing.
   */
  public static resolveMoves(fen: string, d: OpeningData | null | undefined): Array<{ uci: string; san: string }> {
    if (!d || !Array.isArray(d.moves) || d.moves.length === 0) return [];

    let pos: Chess | null = null;
    try {
      pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    } catch {
      // Without a trustworthy position, SAN cannot be resolved. UCI entries are
      // still meaningful on their own, but an unparsable FEN means the caller is
      // working with garbage: report nothing instead of guessing.
      return [];
    }

    const result: Array<{ uci: string; san: string }> = [];
    for (const raw of d.moves) {
      const san = raw.san;
      let uci = raw.uci;

      const isUci = typeof uci === 'string' && isValidUci(uci);
      if (!isUci && san) {
        const parsed = parseSan(pos, san);
        if (parsed) uci = makeUci(parsed);
      }

      if (!uci || !isValidUci(uci)) continue;
      result.push({ uci, san: san ?? uci });
    }
    return result;
  }

  /**
   * Ranks the human moves of a position. The main line is the most played, but
   * a move with (almost) the same popularity is promoted when it scores better,
   * which favours real theory over a marginal pet line.
   */
  public static rank(fen: string, data: OpeningData | null | undefined, sideToMove: 'white' | 'black'): BookMove[] {
    if (!data || !Array.isArray(data.moves)) return [];

    const total = data.moves.reduce((sum, m) => sum + m.white + m.draws + m.black, 0);
    if (total <= 0) return [];

    const moves = this.resolveMoves(fen, data);

    const ranked: BookMove[] = [];
    for (let i = 0; i < data.moves.length; i++) {
      const raw = data.moves[i];
      const resolved = moves[i];
      if (!resolved) continue;

      const games = raw.white + raw.draws + raw.black;
      if (games < MIN_GAMES) continue;

      const scoreForSide =
        sideToMove === 'white'
          ? (raw.white + raw.draws / 2) / games
          : (raw.black + raw.draws / 2) / games;

      ranked.push({
        uci: resolved.uci,
        san: resolved.san,
        frequency: games / total,
        games,
        score: scoreForSide,
      });
    }

    ranked.sort((a, b) => {
      // Same popularity within 25%? Prefer the better practical score.
      if (Math.abs(a.frequency - b.frequency) <= MAX_FREQUENCY_GAP && a.score !== b.score) {
        return b.score - a.score;
      }
      return b.frequency - a.frequency;
    });

    return ranked;
  }

  /**
   * True when `uci` is one of the moves humans actually play in this position.
   */
  public static isTheoryMove(
    fen: string,
    data: OpeningData | null | undefined,
    uci: string
  ): boolean {
    return this.rank(fen, data, fenSideToMove(fen)).some(m => m.uci === uci);
  }

  /**
   * Best human move for the side to move, or null when the position is outside
   * the database (fewer than MIN_GAMES games, unknown opening...).
   */
  public static bestTheoryMove(fen: string, data: OpeningData | null | undefined): BookMove | null {
    const ranked = this.rank(fen, data, fenSideToMove(fen));
    return ranked.length > 0 ? ranked[0] : null;
  }
}

function fenSideToMove(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function isValidUci(value: string | undefined): value is string {
  return typeof value === 'string' && UCI_PATTERN.test(value);
}

export type { OpeningMove };
