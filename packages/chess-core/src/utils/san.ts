import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseUci } from 'chessops/util';
import { makeSan } from 'chessops/san';

/**
 * Converts a UCI move string (e.g. "g1f3") to its SAN notation for a given FEN,
 * or returns null when the move is illegal/unparsable.
 */
export function uciToSan(fen: string, uci: string): string | null {
  try {
    const setup = parseFen(fen).unwrap();
    const pos = Chess.fromSetup(setup).unwrap();
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) return null;
    return makeSan(pos, move);
  } catch {
    return null;
  }
}
