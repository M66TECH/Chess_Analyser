import { MoveClassification } from './types';
import { AccuracyScore } from '../analysis/AccuracyScore';
import { judgeMove, type PovScore, type LichessMateSequence } from '../analysis/LichessAdvice';

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
}

export interface ClassifyResult {
  classification: MoveClassification;
  accuracy: number;
  /** Séquence de mat détectée par le jugement Lichess, quand il y en a une. */
  mateSequence?: LichessMateSequence;
}

export class MoveClassifier {
  /**
   * Classifie un coup.
   *
   * Hiérarchie de décision :
   *  1. Jugement Lichess (CpAdvice → MateAdvice) si les deux scores sont
   *     fournis — c'est ce qui produit ?!/??/?? sur lichess.org ;
   *  2. sinon, barème interne sur le delta de chances :
   *     ≥0.3 blunder, ≥0.2 mistake, ≥0.1 inaccuracy (identique à 1), puis
   *     les classes positives (brillant/great/best) que Lichess n'a pas côté
   *     serveur ;
   *  3. la théorie ne downgrade jamais pire que « good ».
   *
   * ⚠ `winDrop` doit être le delta BRUT de `EvalNormalizer.winningChancesDiff`
   * (sans division par 2) — c'est sur cette échelle que portent les seuils.
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
    let classification: MoveClassification = 'good';
    let mateSequence: LichessMateSequence | undefined;

    // 0. Règle fondamentale de Lichess (`AnalysisBuilder.scala#L87`,
    // `Analysis.scala#L37`, `liveAnnotate.ts#L23`) : si le joueur a joué le
    // meilleur coup recommandé par Stockfish (`playedMove === bestMove`),
    // aucune pénalité (?! / ? / ??) ne peut lui être attribuée, même si
    // l'évaluation fluctue d'un demi-coup à l'autre par effet d'horizon.
    if (isBestMove) {
      return { classification: 'best', accuracy: 100 };
    }

    // 1. Jugement Lichess quand les scores sont disponibles.
    const advised = prevScore && nextScore ? judgeMove(prevScore, nextScore) : undefined;
    const isMateDelayed =
      prevScore?.mate !== undefined &&
      prevScore.mate > 0 &&
      nextScore?.mate !== undefined &&
      nextScore.mate > 0;

    if (advised?.judgment) {
      classification = advised.judgment;
      mateSequence = advised.mateSequence;
    } else if (!isMateDelayed && winDrop >= 0.3) {
      // 2a. Barème d'erreurs identique à CpAdvice, appliqué quand les scores
      // bruts ne sont pas fournis (même échelle, mêmes seuils → aucune
      // divergence possible avec le jugement Lichess).
      classification = 'blunder';
    } else if (!isMateDelayed && winDrop >= 0.2) {
      classification = 'mistake';
    } else if (!isMateDelayed && winDrop >= 0.1) {
      classification = 'inaccuracy';
    } else if (winDrop <= -0.1) {
      // 2b. Classes positives (sans équivalent serveur chez lila).
      classification = 'brilliant';
    } else if (winDrop <= -0.05) {
      classification = 'great';
    } else {
      classification = 'good';
    }

    // 3. La théorie ne tombe jamais sous « good ».
    if (isTheory && (classification === 'inaccuracy' || classification === 'mistake' || classification === 'blunder')) {
      classification = 'good';
    }

    return mateSequence ? { classification, accuracy, mateSequence } : { classification, accuracy };
  }
}
