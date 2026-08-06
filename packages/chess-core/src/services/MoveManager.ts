import { Chess, Position } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';

export class MoveManager {
  private pos: Position;

  constructor(fen?: string) {
    if (fen) {
      const parsed = parseFen(fen).unwrap();
      this.pos = Chess.fromSetup(parsed).unwrap();
    } else {
      this.pos = Chess.default();
    }
  }

  public getFen(): string {
    return makeFen(this.pos.toSetup());
  }

  public playMove(uci: string): boolean {
    let move = parseUci(uci);
    if (!move) return false;
    
    // Check if standard move is legal
    if (!this.pos.isLegal(move)) {
      // Try promotion to queen if it was potentially a promotion missing the 'q'
      const promotionMove = parseUci(uci + 'q');
      if (promotionMove && this.pos.isLegal(promotionMove)) {
        move = promotionMove;
      } else {
        return false;
      }
    }
    
    this.pos.play(move);
    return true;
  }

  public getPosition(): Position {
    return this.pos;
  }
}
