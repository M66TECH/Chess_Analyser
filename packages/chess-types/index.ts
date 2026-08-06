export type MoveClassification = 
  | "book"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export interface MoveEvaluation {
  ply: number;
  playedMove: string;
  bestMove?: string;
  evalBefore?: number;
  evalAfter?: number;
  centipawnLoss?: number;
  mateBefore?: number;
  mateAfter?: number;
  classification: MoveClassification;
  depth: number;
}
