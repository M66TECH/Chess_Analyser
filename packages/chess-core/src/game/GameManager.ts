import { Chess, Position } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';

export class GameManager {
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
    const move = parseUci(uci);
    if (!move) return false;
    
    // Check if move is legal
    if (!this.pos.isLegal(move)) return false;
    
    this.pos.play(move);
    return true;
  }

  public turn(): 'white' | 'black' {
    return this.pos.turn === 'white' ? 'white' : 'black';
  }

  // TODO: Add move history, variations, and more advanced chessops integration
}
