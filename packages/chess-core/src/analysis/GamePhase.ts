import { countPieces } from '../utils/san';

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export interface GamePhaseInfo {
  phase: GamePhase;
  label: string;
}

const PHASE_LABELS: Record<GamePhase, string> = {
  opening: 'Ouverture',
  middlegame: 'Milieu de partie',
  endgame: 'Finale',
};

/**
 * Détermine la phase de jeu (Ouverture, Milieu de partie, Finale)
 * à partir du coup, du FEN et de l'appartenance théorique.
 */
export function classifyGamePhase(params: {
  moveNumber: number;
  fen: string;
  inBook?: boolean;
}): GamePhaseInfo {
  const { moveNumber, fen, inBook } = params;
  const pieces = countPieces(fen);
  const board = fen.split(' ')[0] ?? '';

  // 1. Finale si le matériel total est réduit (<= 12 pièces)
  // ou si les deux dames ont disparu et qu'il reste <= 16 pièces
  const hasWhiteQueen = board.includes('Q');
  const hasBlackQueen = board.includes('q');
  const noQueens = !hasWhiteQueen && !hasBlackQueen;

  if (pieces <= 12 || (noQueens && pieces <= 16)) {
    return { phase: 'endgame', label: PHASE_LABELS.endgame };
  }

  // 2. Ouverture si théorie ou premiers coups (moveNumber <= 10) et matériel plein
  if (inBook || (moveNumber <= 10 && pieces >= 26)) {
    return { phase: 'opening', label: PHASE_LABELS.opening };
  }

  // 3. Milieu de partie par défaut
  return { phase: 'middlegame', label: PHASE_LABELS.middlegame };
}
