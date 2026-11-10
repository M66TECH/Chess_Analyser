import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parseUci, makeSquare, parseSquare } from 'chessops/util';
import { makeSan } from 'chessops/san';
import type { Role } from 'chessops/types';

/**
 * Traduction des coups en français simple, sans jargon.
 *
 * Objectif : un débutant doit comprendre SANS connaître la notation
 * échiquéenne. On ne montre jamais « Nf3 » ni « a4 » seuls : on nomme la
 * pièce et on désigne sa case d'arrivée, en s'appuyant sur le surlignage du
 * plateau (`from` / `to` renvoyés pour l'affichage).
 */

const PIECE_FR: Record<Role, string> = {
  pawn: 'pion',
  knight: 'cavalier',
  bishop: 'fou',
  rook: 'tour',
  queen: 'dame',
  king: 'roi',
};

/** `n` = pièce au féminin ? Utilisé pour accorder « le/la », « déplacé(e) ». */
const FEMININE: Record<Role, boolean> = {
  pawn: false,
  knight: false,
  bishop: false,
  rook: true,
  queen: true,
  king: false,
};

const article = (role: Role): string => (FEMININE[role] ? 'la' : 'le');

export interface MoveDescription {
  text: string;
  /** Case de départ (surlignage). */
  from: string;
  /** Case d'arrivée (surlignage). */
  to: string;
  /** Pièce déplacée, en français. */
  piece: string;
  /** Pièce capturée, en français, si prise. */
  captured?: string;
  /** Le coup donne-t-il échec ? */
  check: boolean;
  /** Le coup donne-t-il mat ? */
  checkmate: boolean;
  /** Roi adverse en échec (case à surligner en rouge). */
  kingSquare?: string;
}

export interface DemoStep {
  /** Position APRÈS le coup, pour l'affichage. */
  fen: string;
  uci: string;
  /** Notation algébrique courte (ex. "e4", "Cf3", "Fxf7+"). */
  san?: string;
  /** Phrase courte, ou '' si elle n'apporte rien. */
  caption: string;
  from: string;
  to: string;
  /** Cases à mettre en évidence (départ + arrivée). */
  highlight: string[];
  /** Case menacée à entourer en rouge (roi en échec, pièce prenable). */
  threat?: string;
  check: boolean;
  checkmate: boolean;
}

/** « en e4 » plutôt que « e4 » : une case se lit comme un lieu. */
const squareFr = (square: number): string => `en ${makeSquare(square)}`;

/**
 * Décrit un coup en une phrase courte et sans notation.
 * Retourne `null` si le coup n'est pas légal dans cette position.
 */
export function describeMove(fen: string, uci: string): MoveDescription | null {
  let pos: Chess;
  try {
    pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  } catch {
    return null;
  }

  const move = parseUci(uci);
  if (!move || !pos.isLegal(move)) return null;

  // `Move` est une union `NormalMove | DropMove` ; ce dernier n'a ni `from`
  // ni `promotion` et n'existe pas en échecs standard.
  if (!('from' in move)) return null;

  const piece = pos.board.get(move.from);
  if (!piece) return null;

  const isCastle = piece.role === 'king' && Math.abs(move.to - move.from) === 2;
  const isEp = piece.role === 'pawn' && move.to === pos.epSquare;
  const capturedPiece = pos.board.get(move.to);

  const after = pos.clone();
  after.play(move);
  const check = after.isCheck();
  const checkmate = after.isCheckmate();

  const movedFr = PIECE_FR[piece.role];
  const capturedFr = isEp
    ? 'pion'
    : capturedPiece && capturedPiece.color !== piece.color
      ? PIECE_FR[capturedPiece.role]
      : undefined;

  // Phrase
  let text: string;
  if (isCastle) {
    text = `Le roi se met à l'abri en roquant.`;
  } else if (move.promotion) {
    text = `Le pion arrive au bout et devient ${article(move.promotion)} ${PIECE_FR[move.promotion]}.`;
  } else if (capturedFr) {
    text = `${capitalize(article(piece.role))} ${movedFr} prend ${article(capturedPiece!.role)} ${capturedFr} ${squareFr(move.to)}.`;
  } else {
    text = `${capitalize(article(piece.role))} ${movedFr} va ${squareFr(move.to)}.`;
  }

  if (checkmate) {
    text += ' Échec et mat.';
  } else if (check) {
    text += ' Le roi est en échec.';
  }

  const kingSquare = check
    ? (() => {
        const king = after.board.kingOf(after.turn);
        return king === undefined ? undefined : makeSquare(king);
      })()
    : undefined;

  return {
    text,
    from: makeSquare(move.from),
    to: makeSquare(move.to),
    piece: movedFr,
    captured: capturedFr,
    check,
    checkmate,
    kingSquare,
  };
}

/**
 * Construit une démonstration pas à pas depuis une position et une suite de
 * coups (PV Stockfish). S'arrête au premier coup illégal.
 *
 * @param fen position de départ (celle de la position réelle au moment du conseil)
 * @param pv coups UCI, alternant les deux camps
 * @param maxPlies nombre de demi-coups à montrer (6 = 3 coups complets)
 */
export function buildDemo(fen: string, pv: string[], maxPlies = 6): DemoStep[] {
  const steps: DemoStep[] = [];

  let pos: Chess;
  try {
    pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  } catch {
    return steps;
  }

  for (const uci of pv.slice(0, maxPlies)) {
    const currentFen = posToFen(pos);
    const description = describeMove(currentFen, uci);
    if (!description) break;

    const move = parseUci(uci)!;
    let san: string | undefined;
    try {
      san = makeSan(pos, move);
    } catch {
      // Ignorer si échec du calcul SAN
    }
    pos.play(move);

    steps.push({
      fen: posToFen(pos),
      uci,
      san,
      caption: description.text,
      from: description.from,
      to: description.to,
      highlight: [description.from, description.to],
      threat: description.kingSquare,
      check: description.check,
      checkmate: description.checkmate,
    });

    if (description.checkmate) break;
  }

  return steps;
}

/**
 * Vérifie qu'une pièce posée sur `square` peut être prise par l'adversaire.
 * Sert à signaler la menace d'une étape de démonstration.
 */
export function isPieceEnPrise(fen: string, square: string): boolean {
  try {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    const idx = parseSquare(square);
    if (idx === undefined) return false;

    const piece = pos.board.get(idx);
    if (!piece) return false;

    // La pièce est-elle attaquée par le camp adverse ?
    return isAttackedBy(pos, idx, piece.color === 'white' ? 'black' : 'white');
  } catch {
    return false;
  }
}

// --- helpers internes -------------------------------------------------------

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const posToFen = (pos: Chess): string => makeFen(pos.toSetup());

/**
 * Attaque d'une case par un camp, via les primitives de chessops.
 * (Chess n'expose pas `attacks()` ; on compose à partir du plateau.)
 */
function isAttackedBy(pos: Chess, square: number, byColor: 'white' | 'black'): boolean {
  const board = pos.board;
  const occupied = board.occupied;

  // Pions
  const pawns = board[byColor].intersect(board.pawn);
  const pawnFrom = byColor === 'white' ? square - 7 : square + 7;
  const pawnFrom2 = byColor === 'white' ? square - 9 : square + 9;
  if (pawns.has(pawnFrom) || pawns.has(pawnFrom2)) return true;

  // Cavaliers
  const knights = board[byColor].intersect(board.knight);
  for (const k of knightTargets(square)) {
    if (knights.has(k)) return true;
  }

  // Roi
  const king = board[byColor].intersect(board.king);
  for (const k of kingTargets(square)) {
    if (king.has(k)) return true;
  }

  // Tours / dames et fous / dames via les rayons
  const rooksQueens = board[byColor].intersect(board.rooksAndQueens());
  const bishopsQueens = board[byColor].intersect(board.bishopsAndQueens());
  if (intersectsAny(rayAttacks(square, occupied, ORTHO), rooksQueens)) return true;
  if (intersectsAny(rayAttacks(square, occupied, DIAG), bishopsQueens)) return true;

  return false;
}

/** Vrai si au moins une case du Set appartient au SquareSet fourni. */
function intersectsAny(squares: Set<number>, set: { has(sq: number): boolean }): boolean {
  for (const sq of squares) {
    if (set.has(sq)) return true;
  }
  return false;
}

const ORTHO: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG: ReadonlyArray<readonly [number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function knightTargets(square: number): number[] {
  const file = square % 8;
  const rank = Math.floor(square / 8);
  const deltas = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const out: number[] = [];
  for (const [df, dr] of deltas) {
    const f = file + df;
    const r = rank + dr;
    if (f >= 0 && f < 8 && r >= 0 && r < 8) out.push(r * 8 + f);
  }
  return out;
}

function kingTargets(square: number): number[] {
  const file = square % 8;
  const rank = Math.floor(square / 8);
  const out: number[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const f = file + df;
      const r = rank + dr;
      if (f >= 0 && f < 8 && r >= 0 && r < 8) out.push(r * 8 + f);
    }
  }
  return out;
}

/** Cases atteignables en ligne droite depuis `square`, arrêt au premier obstacle. */
function rayAttacks(square: number, occupied: { has(sq: number): boolean }, dirs: ReadonlyArray<readonly [number, number]>): Set<number> {
  const out = new Set<number>();
  const file = square % 8;
  const rank = Math.floor(square / 8);

  for (const [df, dr] of dirs) {
    let f = file + df;
    let r = rank + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const sq = r * 8 + f;
      out.add(sq);
      if (occupied.has(sq)) break;
      f += df;
      r += dr;
    }
  }
  return out;
}

