export type MoveClassification = 
  | 'book' 
  | 'brilliant' 
  | 'great' 
  | 'best' 
  | 'excellent' 
  | 'good' 
  | 'inaccuracy' 
  | 'mistake' 
  | 'blunder';

import type { CoachCard } from './ExplanationContext';
import type { LichessMateSequence } from '../analysis/LichessAdvice';

export interface MoveAnalysis {
  id: string;
  fenBefore: string;
  fenAfter: string;
  playedMove: string;
  bestMove?: string;
  /** Variante principale de Stockfish avant le coup (coups UCI). */
  bestPv?: string[];
  /** Variante principale de Stockfish après le coup (réfutation / suite adverse en UCI). */
  refutationPv?: string[];
  /** Écart de chances de gain entre PV1 et PV2 avant le coup (détection de coup forcé/unique). */
  multiPvGap?: number;
  cpBefore: number;
  mateBefore?: number;
  cpAfter: number;
  mateAfter?: number;
  winProbBefore: number;
  winProbAfter: number;
  accuracy: number;
  classification: MoveClassification;
  awareness?: boolean;
  luck?: boolean;
  opening?: string;
  moveNumber: number;
  color: 'white' | 'black';
  san: string;
  /** Human/theory data from the Lichess opening database, when available. */
  theory?: MoveTheory;
  /**
   * Séquence de mat détectée par le jugement Lichess (`MateAdvice`) :
   * `created` = le joueur va se faire mater, `lost` = il avait le mat et l'a
   * perdu, `delayed` = mat toujours forcé (pas de jugement).
   */
  mateSequence?: LichessMateSequence;
}

export type TheoryStatus = 'confirmed' | 'uncertain' | 'out_of_book';
export type TheoryConfidence = 'high' | 'medium' | 'low';
export type MoveEvidence = 'found' | 'not_returned' | 'verified_zero' | 'no_data' | 'unavailable';
export type TheoryEvidenceSource = 'canonical_opening' | 'master_statistics' | 'both' | 'insufficient_data';

export interface MoveTheoryResult {
  /** Statut formel de conformité théorique */
  status: TheoryStatus;
  /** Degré de certitude de la qualification */
  confidence: TheoryConfidence;
  /** Preuve matérielle constatée */
  evidence: MoveEvidence;
  /** Source de la qualification théorique */
  source: TheoryEvidenceSource;
  /** Justification explicite pour le diagnostic et le coach */
  reason: string;
  /** Code ECO de la position (ex: 'B90', 'C50') */
  eco?: string;
  /** Nom canonique complet de la variante */
  openingName?: string;
  /** Nombre total de parties de maîtres recensées dans la position avant le coup */
  totalMasterGamesInPosition: number;
  /** Nombre de parties de maîtres recensées pour le coup joué */
  masterGamesForMove: number;
  /** Part relative du coup joué dans cette position [0, 1] */
  frequency: number;
  /** Vrai si le coup prolonge explicitement une variante canonique locale */
  isCanonicalBookMove: boolean;
  /** Seuil de coupure N12 (volume du 12e coup retourné) */
  cutoffGames?: number;
  /** Numéro du demi-coup du dernier coup théorique confirmé dans la partie */
  lastConfirmedPly?: number;
}

/**
 * Opening-database context attached to a move. Stockfish optimises for perfect
 * play; humans need the moves that are statistically sound and still practical.
 */
export interface MoveTheory extends Partial<MoveTheoryResult> {
  /** The position belongs to a known opening (enough games in the database). */
  inBook: boolean;
  /** ECO code of the opening reached, e.g. "B00". */
  eco?: string;
  /** Opening name, e.g. "King's Pawn Game". */
  openingName?: string;
  /** Share of games (0..1) in which humans played this exact move. */
  frequency?: number;
  /** Number of human games behind that frequency. */
  games?: number;
  /** The move is (close enough to) the main human choice. */
  isTheory: boolean;
}

export interface MoveRecord extends Omit<MoveAnalysis, 'id'> {
  nodeId: string;
  explanation?: string;
  /** Fiche pédagogique générée par l'IA à partir du verdict Lichess. */
  coachCard?: CoachCard;
}

export interface MoveNode {
  id: string;
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
  moveNumber: number;
  color: 'white' | 'black';
  parentId: string | null;
  childrenIds: string[];
  isMainline: boolean;
}

export interface CriticalMoment {
  moveNumber: number;
  color: 'white' | 'black';
  san: string;
  playedMove: string;
  bestMove?: string;
  fenBefore: string;
  winDrop: number;
  cpBefore: number;
  cpAfter: number;
  description: string;
}

export interface GameClassificationCounts {
  brilliant: number;
  great: number;
  best: number;
  excellent: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
  book: number;
}

export interface RecurrentTheme {
  theme: string;
  count: number;
  description: string;
}

export interface GameStats {
  accuracy: { white: number; black: number };
  acpl: { white: number; black: number };
  blunders: { white: number; black: number };
  mistakes: { white: number; black: number };
  inaccuracies: { white: number; black: number };
  perfectDomination?: { white: boolean; black: boolean };
  queensTraded?: boolean;
  classificationCounts?: {
    white: GameClassificationCounts;
    black: GameClassificationCounts;
  };
  phaseStats?: {
    opening?: { white: number; black: number };
    middlegame?: { white: number; black: number };
    endgame?: { white: number; black: number };
  };
  criticalMoment?: CriticalMoment;
  recurrentThemes?: {
    white: RecurrentTheme[];
    black: RecurrentTheme[];
  };
  takeaway?: string;
}
