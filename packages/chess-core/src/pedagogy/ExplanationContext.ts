import type { MoveRecord } from './types';

/**
 * Types d'explication demandés par le cahier des charges. Ils structurent la
 * réponse de l'IA autour de ce que le joueur cherche réellement à comprendre.
 */
export type InsightKind =
  | 'played_move' // le coup joué : ce qu'il fait
  | 'missed_move' // le coup manqué : ce qu'il aurait fallu jouer
  | 'mistake' // erreur / imprécision : pourquoi c'est mauvais
  | 'good_decision' // bonne décision : pourquoi c'était juste
  | 'consequence'; // conséquence tactique ou stratégique

export interface Insight {
  kind: InsightKind;
  /** Phrase courte (≤ 140 caractères idéalement), accessible. */
  text: string;
}

/**
 * Fiche pédagogique produite par l'IA pour un coup.
 * `headline` sert d'accroche, `insights` le détail par axe.
 */
export interface CoachCard {
  headline: string;
  insights: Insight[];
  /** Conseil actionnable en une phrase. */
  takeaway: string;
  /** Niveau de lecture employé, pour transparence. */
  level: PlayerLevel;
}

export type PlayerLevel = 'debutant' | 'intermediaire' | 'avance';

/**
 * Construit le dossier factuel transmis à l'IA.
 *
 * Principe : le modèle ne reçoit QUE des données vérifiables issues de
 * l'analyse Lichess (évaluations, classification, meilleur coup, théorie).
 * Il ne voit jamais la position brute sans contexte, ce qui l'empêche
 * d'inventer des tactiques. C'est le garde-fou central contre les
 * hallucinations sur un jeu aussi précis que les échecs.
 */
export interface ExplanationContext {
  played: {
    san: string;
    uci: string;
    color: 'white' | 'black';
    piece?: string;
    captured?: string | null;
    is_check: boolean;
  };
  /** Coup proposé par l'analyse Lichess, quand le coup joué n'est pas le meilleur. */
  best?: {
    san: string | null;
    uci: string | null;
    /** Perte, en centipions, entre le coup joué et ce meilleur coup. */
    centipawn_gap: number | null;
  };
  /** Évaluations en pions, positive = avantage des Blancs. */
  evaluation: {
    before: number | null;
    after: number | null;
    /** Perte du joueur qui vient de jouer, en centipions. */
    player_loss_cp: number | null;
    mate_before: number | null;
    mate_after: number | null;
  };
  /** Verdict de l'analyse Lichess : classification + précision. */
  verdict: {
    classification: string;
    accuracy_percent: number | null;
  };
  opening: {
    name: string | null;
    eco: string | null;
    in_book: boolean;
    is_theory_move: boolean;
    frequency_percent: number | null;
  } | null;
  context: {
    move_number: number;
    /** Phase estimée, pour adapter le vocabulaire. */
    phase: 'ouverture' | 'milieu' | 'finale';
    previous_classification: string | null;
    /** Séquence de mat détectée par le jugement Lichess, si applicable. */
    mate_sequence: 'created' | 'lost' | 'delayed' | null;
  };
}

const PIECE_FR: Record<string, string> = {
  pawn: 'pion',
  knight: 'cavalier',
  bishop: 'fou',
  rook: 'tour',
  queen: 'dame',
  king: 'roi',
};

export const pieceToFr = (role?: string): string | undefined =>
  role ? PIECE_FR[role] ?? role : undefined;

/**
 * Estime la phase de partie à partir du numéro de coup et du matériel restant.
 * Approximation volontaire : l'IA n'a pas besoin de plus pour choisir son ton.
 */
export function estimatePhase(moveNumber: number, materialCount?: number): ExplanationContext['context']['phase'] {
  if (materialCount !== undefined && materialCount <= 12) return 'finale';
  if (moveNumber <= 12) return 'ouverture';
  if (materialCount !== undefined && materialCount <= 20) return 'finale';
  return 'milieu';
}

export interface BuildContextArgs {
  record: MoveRecord;
  playedPiece?: string;
  capturedPiece?: string | null;
  bestMoveSan?: string | null;
  previousClassification?: string | null;
  materialCount?: number;
}

/** Assemble le dossier factuel à partir d'un `MoveRecord` analysé. */
export function buildExplanationContext({
  record,
  playedPiece,
  capturedPiece,
  bestMoveSan,
  previousClassification,
  materialCount,
}: BuildContextArgs): ExplanationContext {
  const isWhite = record.color === 'white';

  // ⚠ `MoveRecord.cpBefore` / `cpAfter` sont DÉJÀ normalisés du point de vue
  // des Blancs par l'AnalysisPipeline (cf. EvalNormalizer.normalize). Il ne
  // faut donc jamais les inverser ici : le faire double l'inversion pour les
  // Noirs et produit des pertes de chances du mauvais signe.
  const beforeCp = typeof record.cpBefore === 'number' ? record.cpBefore : null;
  const afterCp = typeof record.cpAfter === 'number' ? record.cpAfter : null;

  // Perte du joueur qui vient de jouer, en centipions, toujours ≥ 0.
  const playerLoss =
    beforeCp !== null && afterCp !== null
      ? Math.max(0, isWhite ? beforeCp - afterCp : afterCp - beforeCp)
      : null;

  const isBest = !!record.bestMove && record.bestMove === record.playedMove;
  const centipawnGap =
    !isBest && playerLoss !== null && playerLoss > 0 ? playerLoss : null;

  return {
    played: {
      san: record.san,
      uci: record.playedMove,
      color: record.color,
      piece: playedPiece,
      captured: capturedPiece ?? null,
      is_check: /[+#]$/.test(record.san),
    },
    best: record.bestMove
      ? {
          // Si la conversion UCI→SAN a échoué, on garde l'UCI : mieux vaut
          // transmettre un coup lisible (`e2e4`) que de perdre l'information.
          san: bestMoveSan ?? record.bestMove,
          uci: record.bestMove,
          centipawn_gap: centipawnGap,
        }
      : undefined,
    evaluation: {
      before: beforeCp !== null ? Math.round(beforeCp) : null,
      after: afterCp !== null ? Math.round(afterCp) : null,
      player_loss_cp: playerLoss,
      mate_before: record.mateBefore ?? null,
      mate_after: record.mateAfter ?? null,
    },
    verdict: {
      classification: record.classification,
      accuracy_percent: record.accuracy ?? null,
    },
    opening: record.theory
      ? {
          name: record.theory.openingName ?? null,
          eco: record.theory.eco ?? null,
          in_book: record.theory.inBook,
          is_theory_move: record.theory.isTheory,
          frequency_percent:
            record.theory.frequency !== undefined
              ? Math.round(record.theory.frequency * 100)
              : null,
        }
      : null,
    context: {
      move_number: record.moveNumber,
      phase: estimatePhase(record.moveNumber, materialCount),
      previous_classification: previousClassification ?? null,
      mate_sequence: record.mateSequence ?? null,
    },
  };
}
