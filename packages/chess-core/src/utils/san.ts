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

/**
 * Convertit une séquence de coups UCI (variante PV) en coups SAN successifs
 * à partir d'une position FEN initiale. S'arrête au premier coup illégal.
 */
export function pvToSan(fen: string, pvUci: string[]): string[] {
  const sanMoves: string[] = [];
  try {
    const setup = parseFen(fen).unwrap();
    const pos = Chess.fromSetup(setup).unwrap();
    for (const uci of pvUci) {
      const move = parseUci(uci);
      if (!move || !pos.isLegal(move)) break;
      sanMoves.push(makeSan(pos, move));
      pos.play(move);
    }
  } catch {
    // Retourne les coups déjà convertis
  }
  return sanMoves;
}

/** Coup UCI valide : 4 caractères, ou 5 avec la pièce de promotion. */
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** Forme d'une flèche/cercle pour chessground. */
export interface BoardShape {
  orig: string;
  dest?: string;
  brush: string;
}

/**
 * Convertit un coup UCI en flèche chessground.
 *
 * Gère les promotions (`e7e8q` → `e7`/`e8`), là où une découpe naïve par
 * index restait fragile. Retourne `null` pour une chaîne non UCI.
 */
export function uciToShape(uci: string): { orig: string; dest: string } | null {
  if (!UCI_PATTERN.test(uci)) return null;
  return { orig: uci.slice(0, 2), dest: uci.slice(2, 4) };
}

/**
 * Construit la flèche d'une ligne PV (premier coup de la variante).
 * Retourne `null` si la PV est vide ou commence par un coup illisible.
 */
export function pvToShape(pv: string[] | undefined, brush: string): BoardShape | null {
  const first = pv?.[0];
  if (!first) return null;
  const shape = uciToShape(first);
  return shape ? { ...shape, brush } : null;
}

/** Nombre de pièces présentes sur l'échiquier, depuis un FEN. */
export function countPieces(fen: string): number {
  const board = fen.split(' ')[0];
  let count = 0;
  for (const char of board) {
    if (char !== '/' && !/[1-8]/.test(char)) count++;
  }
  return count;
}
