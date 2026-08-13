export type MoveClassification = 
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'book';

export interface TacticalMotif {
  type: 'fork' | 'pin' | 'skewer' | 'discovered_attack' | 'hanging_piece';
  squares: string[];
  description: string;
}

export interface StrategicEvaluation {
  centerControl: number;
  kingSafety: number;
  materialAdvantage: number;
}

export interface MoveRecord {
  moveNumber: number;
  color: 'white' | 'black';
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  cpBefore?: number;
  cpAfter?: number;
  mateBefore?: number;
  mateAfter?: number;
  winProbBefore: number;
  winProbAfter: number;
  accuracy: number;
  classification: MoveClassification;
  tacticalMotifs: TacticalMotif[];
  explanation: string;
  bestMove?: string;
  opening?: string;
}

export interface MoveAnalysis {
  id: string;
  fenBefore: string;
  fenAfter: string;
  playedMove: string;
  bestMove?: string;
  cpBefore?: number;
  mateBefore?: number;
  cpAfter?: number;
  mateAfter?: number;
  winProbBefore: number;
  winProbAfter: number;
  accuracy: number;
  classification: MoveClassification;
  tacticalMotifs: TacticalMotif[];
  strategicEval?: StrategicEvaluation;
  explanation: string;
  opening?: string;
  moveNumber?: number;
  color?: 'white' | 'black';
  san?: string;
}

export interface GameAccuracy {
  overall: number;
  white: number;
  black: number;
  opening: number;
  middlegame: number;
  endgame: number;
}
