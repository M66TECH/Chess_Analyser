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

export interface VerifiedTacticalFacts {
  fen_before: string;
  fen_after: string;
  /** Suite concrète de réfutation / réponse adverse en notation SAN. */
  refutation_pv_san: string[];
  /** Bilan matériel net (en pions, du point de vue du joueur) au bout de la PV adverse. */
  material_delta_in_pv: number;
  /** Pièces du joueur nouvellement laissées en prise (SEE > 0 pour l'adversaire). */
  newly_undefended_own_pieces: Array<{
    square: string;
    piece: string;
    loss: number;
    attacker_square: string;
  }>;
  /** Pièces adverses nouvellement mises en prise par le coup joué. */
  newly_undefended_enemy_pieces: Array<{
    square: string;
    piece: string;
    gain: number;
  }>;
  /** Nouveaux clouages subis par le joueur après son coup. */
  new_pins_against_player: Array<{
    pinned_square: string;
    pinned_piece: string;
    pinner_square: string;
    pinner_piece: string;
    target_square: string;
    is_absolute: boolean;
  }>;
  /** Nouveaux clouages infligés à l'adversaire par le coup joué. */
  new_pins_by_player: Array<{
    pinned_square: string;
    pinned_piece: string;
    pinner_square: string;
    pinner_piece: string;
    target_square: string;
    is_absolute: boolean;
  }>;
  /** Changements objectifs de structure de pions et de sécurité du roi. */
  positional_changes: {
    doubled_pawns_created: string[];
    isolated_pawns_created: string[];
    passed_pawns_created: string[];
    undeveloped_minors_count: number;
    open_files_near_king: string[];
  };
}

/**
 * Construit le dossier factuel transmis à l'IA.
 *
 * Principe : le modèle ne reçoit QUE des données vérifiables issues de
 * l'analyse Lichess (évaluations, classification, meilleur coup, variantes SAN,
 * motifs tactiques SEE/clouages et structure de pions calculés sur l'échiquier).
 */
export interface ExplanationContext {
  /** Position avant le coup : indispensable pour décrire les coups en clair. */
  fen_before: string;
  played: {
    san: string;
    uci: string;
    color: 'white' | 'black';
    piece?: string;
    captured?: string | null;
    is_check: boolean;
    /** Le coup livre échec et mat (SAN terminé par #). */
    is_mate: boolean;
  };
  /** Coup proposé par l'analyse Lichess, quand le coup joué n'est pas le meilleur. */
  best?: {
    san: string | null;
    uci: string | null;
    /** Perte, en centipions, entre le coup joué et ce meilleur coup. */
    centipawn_gap: number | null;
    /** Suite de la meilleure variante en SAN (ex: ["e4", "e5", "Nf3"]). */
    pv_san?: string[];
  };
  /** Évaluations en centipions, positive = avantage des Blancs. */
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
  /** Faits tactiques et positionnels déterministes extraits de la position et des PV. */
  tactical_facts?: VerifiedTacticalFacts;
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
  bestPvSan?: string[];
  previousClassification?: string | null;
  materialCount?: number;
  tacticalFacts?: VerifiedTacticalFacts;
}

/** Assemble le dossier factuel à partir d'un `MoveRecord` analysé. */
export function buildExplanationContext({
  record,
  playedPiece,
  capturedPiece,
  bestMoveSan,
  bestPvSan,
  previousClassification,
  materialCount,
  tacticalFacts,
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

  // Normalisation de `mateBefore` (POV joueur au trait avant le coup) et
  // `mateAfter` (POV adversaire au trait après le coup) vers le POV des Blancs.
  const mateBeforeWhitePov =
    typeof record.mateBefore === 'number'
      ? record.mateBefore === 0
        ? 0
        : isWhite
          ? record.mateBefore
          : -record.mateBefore
      : null;
  const mateAfterWhitePov =
    typeof record.mateAfter === 'number'
      ? record.mateAfter === 0
        ? 0
        : isWhite
          ? -record.mateAfter
          : record.mateAfter
      : null;

  const ctx: ExplanationContext = {
    fen_before: record.fenBefore,
    played: {
      san: record.san,
      uci: record.playedMove,
      color: record.color,
      piece: playedPiece,
      captured: capturedPiece ?? null,
      is_check: /[+#]$/.test(record.san),
      is_mate: record.san.endsWith('#'),
    },
    best: record.bestMove
      ? {
          // Si la conversion UCI→SAN a échoué, on garde l'UCI : mieux vaut
          // transmettre un coup lisible (`e2e4`) que de perdre l'information.
          san: bestMoveSan ?? record.bestMove,
          uci: record.bestMove,
          centipawn_gap: centipawnGap,
          ...(bestPvSan && bestPvSan.length > 0 ? { pv_san: bestPvSan } : {}),
        }
      : undefined,
    evaluation: {
      before: beforeCp !== null ? Math.round(beforeCp) : null,
      after: afterCp !== null ? Math.round(afterCp) : null,
      player_loss_cp: playerLoss,
      mate_before: mateBeforeWhitePov,
      mate_after: mateAfterWhitePov,
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

  if (tacticalFacts) {
    ctx.tactical_facts = tacticalFacts;
  }

  return ctx;
}
