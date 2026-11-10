import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';
import type { Role } from 'chessops/types';
import type { PovScore } from '../analysis/LichessAdvice';

export interface BrilliancyComponents {
  cSac: number;
  cQuality: number;
  cNecessity: number;
  cContext: number;
}

export interface BrilliancyEvaluation {
  score: number;
  classification: 'brilliant' | 'great' | null;
  components: BrilliancyComponents;
}

const PIECE_VALUES: Record<Role, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
};

/**
 * Calcule le matériel d'un camp sur l'échiquier.
 */
function getMaterialForColor(chess: Chess, color: 'white' | 'black'): number {
  let total = 0;
  for (const square of chess.board[color]) {
    const piece = chess.board.get(square);
    if (piece) {
      total += PIECE_VALUES[piece.role] || 0;
    }
  }
  return total;
}

/**
 * Détecte si un coup constitue un sacrifice de matériel en comparant le matériel
 * avant le coup et après la meilleure réponse adverse dans la variante.
 */
export function detectMaterialSacrifice(
  fenBefore?: string,
  playedMove?: string,
  pv?: string[]
): number {
  if (!fenBefore || !playedMove) return 0;

  try {
    const pos = Chess.fromSetup(parseFen(fenBefore).unwrap()).unwrap();
    const moverColor = pos.turn;

    const initialMoverMat = getMaterialForColor(pos, moverColor);

    // Jouer le coup
    const move = parseUci(playedMove);
    if (!move) return 0;
    pos.play(move);

    // Jouer la meilleure réponse adverse (PV[0] ou PV[1])
    const opponentMoveUci = pv && pv.length > 0 ? (pv[0] === playedMove ? pv[1] : pv[0]) : undefined;
    if (opponentMoveUci) {
      const oppMove = parseUci(opponentMoveUci);
      if (oppMove) {
        pos.play(oppMove);
      }
    }

    const finalMoverMat = getMaterialForColor(pos, moverColor);
    const materialLost = initialMoverMat - finalMoverMat;
    return Math.max(0, materialLost);
  } catch {
    return 0;
  }
}

/**
 * Calcule la note de sacrifice C_sac [0, 1].
 */
export function calculateSacrificeScore(sacVal: number): number {
  if (sacVal >= 7) return 1.0; // Dame
  if (sacVal >= 4) return 0.85; // Tour
  if (sacVal >= 2.5) return 0.70; // Pièce mineure
  if (sacVal >= 1.5) return 0.55; // Qualité (Tour vs mineure)
  if (sacVal >= 1.0) return 0.35; // Pion
  return 0.0;
}

/**
 * Calcule le score composite d'un coup brillant (!!) ou grand coup (!).
 *
 * Formule du plan d'évolution V3 :
 * S_brilliant = 0.35 * C_sac + 0.30 * C_quality + 0.25 * C_necessity + 0.10 * C_context
 */
export function evaluateBrilliancy(options: {
  fenBefore?: string;
  playedMove?: string;
  isBestMove: boolean;
  pv?: string[];
  multiPvGap?: number;
  prevScore?: PovScore;
  nextScore?: PovScore;
  sacrificeValue?: number;
  winDrop?: number;
}): BrilliancyEvaluation {
  // 1. C_quality (Qualité du coup)
  let cQuality = 0.0;
  const isLosing = (options.winDrop ?? 0) >= 0.15;
  const losesMate = options.nextScore?.mate !== undefined && options.nextScore.mate < 0;

  if (isLosing || losesMate) {
    cQuality = 0.0;
  } else if (options.isBestMove) {
    cQuality = 1.0;
  } else if (options.prevScore?.cp !== undefined && options.nextScore?.cp !== undefined) {
    const cpDrop = Math.max(0, options.prevScore.cp - options.nextScore.cp);
    if (cpDrop <= 15) cQuality = 0.95;
    else if (cpDrop <= 35) cQuality = 0.70;
    else if (cpDrop <= 60) cQuality = 0.40;
    else cQuality = 0.0;
  } else {
    cQuality = 0.85;
  }

  // 2. C_sac (Sacrifice)
  const sacVal =
    options.sacrificeValue !== undefined
      ? options.sacrificeValue
      : detectMaterialSacrifice(options.fenBefore, options.playedMove, options.pv);
  const cSac = calculateSacrificeScore(sacVal);

  // 3. C_necessity (Unicité / Écart PV1 vs PV2)
  let cNecessity = 0.30;
  if (options.multiPvGap !== undefined) {
    const gap = options.multiPvGap;
    if (gap >= 0.15) cNecessity = 1.0;
    else if (gap >= 0.08) cNecessity = 0.75;
    else if (gap >= 0.04) cNecessity = 0.50;
    else cNecessity = 0.20;
  } else if (options.isBestMove) {
    cNecessity = 0.70;
  }

  // 4. C_context (Tension de la position)
  let cContext = 1.0;
  const cpBefore = Math.abs(options.prevScore?.cp ?? 0);
  if (cpBefore <= 250) {
    cContext = 1.0;
  } else if (cpBefore <= 500) {
    cContext = 0.70;
  } else if (cpBefore <= 800) {
    cContext = 0.40;
  } else {
    cContext = 0.10; // Déjà +800 / +1000 : gain trivial, sacrifice superficiel
  }

  // Formule composite pondérée
  const score =
    0.35 * cSac +
    0.30 * cQuality +
    0.25 * cNecessity +
    0.10 * cContext;

  const components: BrilliancyComponents = {
    cSac,
    cQuality,
    cNecessity,
    cContext,
  };

  // Décision de classification :
  // - Coup Brillant (!!) : score >= 0.70, vrai sacrifice (>= pièce mineure) et excellente qualité (best move / PV1)
  if (score >= 0.70 && cSac >= 0.65 && cQuality >= 0.85) {
    return { score, classification: 'brilliant', components };
  }

  // - Grand Coup (!) :
  //   Cas A : Sacrifice positionnel modéré bien calculé (pion ou qualité) dans une position disputée
  const isPositionalSacrifice =
    cSac >= 0.35 && score >= 0.55 && cQuality >= 0.85 && cContext >= 0.50;
  //   Cas B : Coup unique crucial dans une position tendue (seul coup salvateur ou seul coup gagnant avec gros écart PV1-PV2)
  const isCrucialSavingMove =
    options.multiPvGap !== undefined &&
    options.multiPvGap >= 0.15 &&
    cQuality >= 0.90 &&
    cContext >= 0.50;

  if (isPositionalSacrifice || isCrucialSavingMove) {
    return { score, classification: 'great', components };
  }

  return { score, classification: null, components };
}
