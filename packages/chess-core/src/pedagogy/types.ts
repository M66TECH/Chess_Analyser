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
  opening?: string;
  moveNumber: number;
  color: 'white' | 'black';
  san: string;
}

export type MoveRecord = Omit<MoveAnalysis, 'id'>;

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

export interface GameAccuracy {
  white: number;
  black: number;
}
