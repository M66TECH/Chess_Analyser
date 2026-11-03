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

/**
 * Opening-database context attached to a move. Stockfish optimises for perfect
 * play; humans need the moves that are statistically sound and still practical.
 */
export interface MoveTheory {
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

export interface GameStats {
  accuracy: { white: number; black: number };
  acpl: { white: number; black: number };
  blunders: { white: number; black: number };
  mistakes: { white: number; black: number };
  inaccuracies: { white: number; black: number };
  perfectDomination?: { white: boolean; black: boolean };
  queensTraded?: boolean;
}
