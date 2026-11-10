import { MoveClassification } from './types';
import { AccuracyScore } from '../analysis/AccuracyScore';
import { judgeMove, type PovScore, type LichessMateSequence } from '../analysis/LichessAdvice';
import {
  evaluateBrilliancy,
  type BrilliancyComponents,
} from './BrilliancyEngine';

export interface ClassifyOptions {
  /** True quand le coup joué égale le meilleur coup de l'analyse. */
  isBestMove?: boolean;
  /**
   * True quand le coup joué est de la théorie humaine (base Lichess).
   * Un coup de théorie n'est jamais graded pire que « good » : une ligne
   * jouée par des milliers de joueurs n'est pas une faute, même quand
   * Stockfish préfère autre chose.
   */
  isTheory?: boolean;
  /**
   * Score AVANT le coup, du point de vue du joueur (cp OU mate).
   * Fourni avec `nextScore`, déclenche le jugement Lichess (`Advice.scala`) :
   * CpAdvice (delta brut .3/.2/.1) puis MateAdvice (séquences de mat).
   */
  prevScore?: PovScore;
  /** Score APRÈS le coup, du point de vue du joueur. */
  nextScore?: PovScore;
  /** FEN avant le coup joué. */
  fenBefore?: string;
  /** Coup UCI joué. */
  playedMove?: string;
  /** Meilleur coup recommandé par le moteur. */
  bestMove?: string;
  /** Ligne principale du moteur (PV). */
  pv?: string[];
  /** Écart de chances entre PV1 et PV2. */
  multiPvGap?: number;
  /** Valeur de sacrifice en pions (si précalculée). */
  sacrificeValue?: number;
}

export interface ClassifyResult {
  classification: MoveClassification;
  accuracy: number;
  /** Séquence de mat détectée par le jugement Lichess, quand il y en a une. */
  mateSequence?: LichessMateSequence;
  /** Score composite d'éclat / brillance [0, 1]. */
  brilliancyScore?: number;
  /** Détail des composants de brillance. */
  brilliancyComponents?: BrilliancyComponents;
}

export class MoveClassifier {
  /**
   * Classifie un coup.
   *
   * Hiérarchie de décision :
   *  1. Jugement Lichess (CpAdvice → MateAdvice) pour les fautes (!?, ?, ??),
   *     avec protection théorique (la théorie ne tombe jamais sous « good ») ;
   *  2. Évaluation des Coups Brillants (!!) et Grands Coups (!) via la formule
   *     composite (P2.13) ;
   *  3. Si le coup joué est le meilleur coup recommandé (`isBestMove`), 'best' ;
   *  4. Si perte négligeable (winDrop <= 0.03), 'excellent' ;
   *  5. Sinon, 'good'.
   *
   * @param winDrop chances perdues par le joueur (positif = perte)
   */
  public static classify(
    winDrop: number,
    isBestMoveOrOptions: boolean | ClassifyOptions = false
  ): ClassifyResult {
    const options: ClassifyOptions =
      typeof isBestMoveOrOptions === 'boolean'
        ? { isBestMove: isBestMoveOrOptions }
        : isBestMoveOrOptions;
    const isBestMove = options.isBestMove ?? false;
    const isTheory = options.isTheory ?? false;
    const prevScore = options.prevScore;
    const nextScore = options.nextScore;

    const accuracy = isBestMove ? 100 : AccuracyScore.calculateMoveAccuracy(winDrop);
    let mateSequence: LichessMateSequence | undefined;

    // 1. Règle Lichess : Si c'est le meilleur coup ('isBestMove'), AUCUNE pénalité
    //    (?/??/!?) n'est possible (effet d'horizon).
    if (!isBestMove) {
      const advised = prevScore && nextScore ? judgeMove(prevScore, nextScore) : undefined;
      const isMateDelayed =
        prevScore?.mate !== undefined &&
        prevScore.mate > 0 &&
        nextScore?.mate !== undefined &&
        nextScore.mate > 0;

      let faultJudgment = advised?.judgment;
      if (!faultJudgment && !isMateDelayed) {
        if (winDrop >= 0.3) faultJudgment = 'blunder';
        else if (winDrop >= 0.2) faultJudgment = 'mistake';
        else if (winDrop >= 0.1) faultJudgment = 'inaccuracy';
      }

      if (faultJudgment) {
        mateSequence = advised?.mateSequence;
        if (isTheory) {
          // La théorie humaine protège contre les jugements négatifs
          return mateSequence ? { classification: 'good', accuracy, mateSequence } : { classification: 'good', accuracy };
        }
        return mateSequence
          ? { classification: faultJudgment, accuracy, mateSequence }
          : { classification: faultJudgment, accuracy };
      }
    }

    // 2. Évaluation des coups positifs remarquables (Brillants !! et Grands Coups !)
    const brilliancy = evaluateBrilliancy({
      fenBefore: options.fenBefore,
      playedMove: options.playedMove,
      isBestMove,
      pv: options.pv,
      multiPvGap: options.multiPvGap,
      prevScore,
      nextScore,
      sacrificeValue: options.sacrificeValue,
      winDrop,
    });

    if (brilliancy.classification === 'brilliant') {
      return {
        classification: 'brilliant',
        accuracy,
        brilliancyScore: brilliancy.score,
        brilliancyComponents: brilliancy.components,
      };
    }

    if (brilliancy.classification === 'great') {
      return {
        classification: 'great',
        accuracy,
        brilliancyScore: brilliancy.score,
        brilliancyComponents: brilliancy.components,
      };
    }

    // 3. Meilleur coup standard
    if (isBestMove) {
      return { classification: 'best', accuracy: 100 };
    }

    // 4. Coups de très haute précision (si une évaluation avant/après comparative existe)
    if (prevScore !== undefined && nextScore !== undefined && winDrop <= 0.03) {
      return { classification: 'excellent', accuracy };
    }

    return { classification: 'good', accuracy };
  }
}
