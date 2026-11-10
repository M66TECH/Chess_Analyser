import { EvalNormalizer } from '../analysis/EvalNormalizer';
import type { MoveRecord } from './types';

export interface RetryEvaluationParams {
  candidateUci: string;
  blunderRecord: MoveRecord;
  /**
   * Évaluation en centipions (POV Blanc) après le coup candidat proposé par le joueur.
   * Si non fournie et que le coup n'est pas le bestMove, une évaluation est nécessaire.
   */
  candidateCp?: number;
  /**
   * Évaluation en centipions (POV Blanc) après le meilleur coup `bestMove`.
   * Si omise, déduite de `blunderRecord.cpBefore`.
   */
  bestMoveCp?: number;
}

export interface RetryEvaluationResult {
  success: boolean;
  isExactBest: boolean;
  deltaWinningChances: number;
  message: string;
}

/** Seuil de tolérance imposé par le Master Plan : deltaWinningChances <= 0.02 (delta brut [-1, 1]) */
export const RETRY_TOLERANCE_THRESHOLD = 0.02;

/**
 * Valide un coup candidat proposé par l'utilisateur lors du mode "Retry Blunder".
 *
 * Règle d'or :
 * 1. Correspondance exacte avec `bestMove` -> Succès immédiat (delta = 0).
 * 2. Coup alternatif : validé si la perte de chances de gain reste inférieure ou égale à 0.02.
 */
export function evaluateRetryMove(params: RetryEvaluationParams): RetryEvaluationResult {
  const { candidateUci, blunderRecord, candidateCp, bestMoveCp } = params;
  const bestMove = blunderRecord.bestMove;

  // 1. Coup exact
  if (bestMove && candidateUci.toLowerCase() === bestMove.toLowerCase()) {
    return {
      success: true,
      isExactBest: true,
      deltaWinningChances: 0,
      message: 'Parfait ! Vous avez trouvé le meilleur coup identifié par le moteur.',
    };
  }

  // 2. Évaluation de l'alternative si les scores sont disponibles
  if (typeof candidateCp === 'number') {
    // Score après le meilleur coup (idéalement bestMoveCp, sinon cpBefore qui est la position avant la gaffe)
    const refCp = typeof bestMoveCp === 'number' ? bestMoveCp : blunderRecord.cpBefore;
    
    // Perte brute de chances de gain du point de vue du joueur
    const delta = EvalNormalizer.winningChancesDiff(refCp, candidateCp, blunderRecord.color);

    if (delta <= RETRY_TOLERANCE_THRESHOLD) {
      return {
        success: true,
        isExactBest: false,
        deltaWinningChances: Math.max(0, delta),
        message: 'Excellent réflexe ! Ce coup alternatif est tout aussi performant que la ligne principale.',
      };
    }

    return {
      success: false,
      isExactBest: false,
      deltaWinningChances: Math.max(0, delta),
      message: 'Ce coup reste inférieur et ne résout pas la gaffe. Tentez une autre idée !',
    };
  }

  // Si on n'a pas encore le score cp du coup candidat et qu'il n'est pas le bestMove
  return {
    success: false,
    isExactBest: false,
    deltaWinningChances: 1,
    message: 'Coup non optimal. Continuez à chercher le meilleur coup !',
  };
}
