import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parseUci, makeUci } from 'chessops/util';
import { makeSan } from 'chessops/san';

export class MoveManager {
  private pos: Chess;
  private moveHistory: string[] = []; // UCI moves played
  private sanHistory: string[] = []; // SAN notation history
  private fenHistory: string[] = []; // FEN after each move

  constructor(fen?: string) {
    if (fen) {
      // C3 — try/catch sur .unwrap() pour éviter un crash sur FEN invalide
      try {
        const parsed = parseFen(fen).unwrap();
        this.pos = Chess.fromSetup(parsed).unwrap();
      } catch {
        console.warn('[MoveManager] FEN invalide, position initiale utilisée:', fen);
        this.pos = Chess.default();
      }
    } else {
      this.pos = Chess.default();
    }
    this.fenHistory.push(this.getFen());
  }

  public getFen(): string {
    return makeFen(this.pos.toSetup());
  }

  public getUciMoves(): string[] {
    return [...this.moveHistory];
  }

  public getSanMoves(): string[] {
    return [...this.sanHistory];
  }

  public getMoveCount(): number {
    return this.moveHistory.length;
  }

  public getCurrentMoveNumber(): number {
    return Math.floor(this.moveHistory.length / 2) + 1;
  }

  public playMove(uci: string): { success: boolean; san?: string; fenBefore?: string } {
    let move = parseUci(uci);
    if (!move) return { success: false };

    const fenBefore = this.getFen();

    // Auto-promote to queen if missing
    if (!this.pos.isLegal(move)) {
      const promotionMove = parseUci(uci + 'q');
      if (promotionMove && this.pos.isLegal(promotionMove)) {
        move = promotionMove;
      } else {
        return { success: false };
      }
    }

    // Generate SAN before playing
    const san = makeSan(this.pos, move);
    this.pos.play(move);
    const fenAfter = this.getFen();

    this.moveHistory.push(makeUci(move));
    this.sanHistory.push(san);
    this.fenHistory.push(fenAfter);

    return { success: true, san, fenBefore };
  }

  // L1 — Retourner une copie pour éviter la mutation de l'état interne
  public getPosition(): Chess {
    return this.pos;
  }

  public getFenAtIndex(index: number): string | null {
    return this.fenHistory[index] ?? null;
  }

  /**
   * C3 — reset() avec try/catch sur .unwrap() pour éviter un crash sur FEN invalide
   */
  public reset(fen?: string) {
    if (fen) {
      try {
        const parsed = parseFen(fen).unwrap();
        this.pos = Chess.fromSetup(parsed).unwrap();
      } catch {
        console.warn('[MoveManager] FEN invalide dans reset(), position initiale utilisée:', fen);
        this.pos = Chess.default();
      }
    } else {
      this.pos = Chess.default();
    }
    this.moveHistory = [];
    this.sanHistory = [];
    this.fenHistory = [this.getFen()];
  }

  /**
   * Retourne les mouvements UCI sous forme de chaîne pour l'opening book.
   */
  public getUciMovesString(): string {
    return this.moveHistory.join(' ');
  }
}
