import { Position } from 'chessops/chess';
import { TacticalMotif } from './types';
import { Square } from 'chessops/types';
import { attacks } from 'chessops/attacks';

const PIECE_VALUES: Record<string, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 100,
};

export class TacticalEngine {
  public static analyze(pos: Position): TacticalMotif[] {
    const motifs: TacticalMotif[] = [];
    motifs.push(...this.detectHangingPieces(pos));
    motifs.push(...this.detectForks(pos));
    motifs.push(...this.detectPins(pos));
    return motifs;
  }

  private static squareToAlg(sq: Square): string {
    const file = String.fromCharCode(97 + (sq % 8));
    const rank = Math.floor(sq / 8) + 1;
    return `${file}${rank}`;
  }

  private static detectHangingPieces(pos: Position): TacticalMotif[] {
    const motifs: TacticalMotif[] = [];
    const board = pos.board;
    const turn = pos.turn;
    // Check opponent's pieces that are undefended and attacked
    const opponent = turn === 'white' ? 'black' : 'white';

    for (let sq = 0 as Square; sq < 64; sq++) {
      const piece = board.get(sq);
      if (!piece || piece.color !== opponent) continue;
      if (piece.role === 'king') continue;

      // Is this piece attacked by the side to move?
      const attackers = pos.kingAttackers(sq, turn, board.occupied);
      if (attackers.isEmpty()) continue;

      // Is it defended?
      const defenders = pos.kingAttackers(sq, opponent, board.occupied);

      if (defenders.isEmpty()) {
        motifs.push({
          type: 'hanging_piece',
          squares: [this.squareToAlg(sq)],
          description: `Le(a) ${piece.role} sur ${this.squareToAlg(sq)} est en prise et sans défense.`,
        });
      }
    }
    return motifs;
  }

  private static detectForks(pos: Position): TacticalMotif[] {
    const motifs: TacticalMotif[] = [];
    const board = pos.board;
    const turn = pos.turn;
    const opponent = turn === 'white' ? 'black' : 'white';

    for (let sq = 0 as Square; sq < 64; sq++) {
      const piece = board.get(sq);
      if (!piece || piece.color !== turn) continue;

      const attacked = attacks(piece, sq, board.occupied);
      const attackedValuablePieces: Square[] = [];

      for (const targetSq of attacked) {
        const target = board.get(targetSq as Square);
        if (
          target &&
          target.color === opponent &&
          // E2 — Fix fourchette de reine : utiliser PIECE_VALUES[target.role] > 0
          // pour inclure toutes les pièces (y compris les pièces moins chères que l'attaquant).
          // Le fork est un concept positionnel, pas matériel.
          PIECE_VALUES[target.role] > 0
        ) {
          attackedValuablePieces.push(targetSq as Square);
        }
      }

      if (attackedValuablePieces.length >= 2) {
        const squares = [this.squareToAlg(sq), ...attackedValuablePieces.map(s => this.squareToAlg(s))];
        motifs.push({
          type: 'fork',
          squares,
          description: `Le(a) ${piece.role} sur ${this.squareToAlg(sq)} attaque simultanément ${attackedValuablePieces.length} pièces : ${attackedValuablePieces.map(s => this.squareToAlg(s)).join(', ')}.`,
        });
      }
    }
    return motifs;
  }

  private static detectPins(pos: Position): TacticalMotif[] {
    const motifs: TacticalMotif[] = [];
    const board = pos.board;
    const turn = pos.turn;
    const opponent: 'white' | 'black' = turn === 'white' ? 'black' : 'white';

    // Find opponent king square
    let opponentKingSq: Square | null = null;
    for (let sq = 0 as Square; sq < 64; sq++) {
      const p = board.get(sq);
      if (p && p.color === opponent && p.role === 'king') {
        opponentKingSq = sq;
        break;
      }
    }
    if (opponentKingSq === null) return motifs;

    const kingSq = opponentKingSq;
    const kFile = kingSq % 8;
    const kRank = Math.floor(kingSq / 8);

    // For each sliding attacker of the side to move, check for pins
    for (let sq = 0 as Square; sq < 64; sq++) {
      const piece = board.get(sq);
      if (!piece || piece.color !== turn) continue;
      if (!['bishop', 'rook', 'queen'].includes(piece.role)) continue;

      const pFile = sq % 8;
      const pRank = Math.floor(sq / 8);

      // Determine if piece and king are on same file, rank, or diagonal
      const sameFile = pFile === kFile;
      const sameRank = pRank === kRank;
      const sameDiag = Math.abs(pFile - kFile) === Math.abs(pRank - kRank);

      const canAttack =
        (piece.role === 'rook' && (sameFile || sameRank)) ||
        (piece.role === 'bishop' && sameDiag) ||
        (piece.role === 'queen' && (sameFile || sameRank || sameDiag));

      if (!canAttack) continue;

      // Walk squares between this piece and the king
      const dFile = Math.sign(kFile - pFile);
      const dRank = Math.sign(kRank - pRank);

      const pinned: Square[] = [];
      let curFile = pFile + dFile;
      let curRank = pRank + dRank;

      while (curFile !== kFile || curRank !== kRank) {
        if (curFile < 0 || curFile > 7 || curRank < 0 || curRank > 7) break;
        const curSq = (curRank * 8 + curFile) as Square;
        const curPiece = board.get(curSq);
        if (curPiece) {
          if (curPiece.color === opponent) {
            pinned.push(curSq);
          } else {
            // Own piece blocks — no pin
            pinned.length = 0;
            break;
          }
        }
        curFile += dFile;
        curRank += dRank;
      }

      if (pinned.length === 1) {
        const pinnedPiece = board.get(pinned[0]);
        motifs.push({
          type: 'pin',
          squares: [this.squareToAlg(sq), this.squareToAlg(pinned[0]), this.squareToAlg(kingSq)],
          description: `Le(a) ${piece.role} sur ${this.squareToAlg(sq)} cloue le(a) ${pinnedPiece?.role ?? 'pièce'} sur ${this.squareToAlg(pinned[0])} contre le roi adverse.`,
        });
      }
    }
    return motifs;
  }
}
