import { Position } from 'chessops/chess';
import { SquareSet } from 'chessops/squareSet';
import { attacks } from 'chessops/attacks';
import { Square } from 'chessops/types';
import { HeatmapData } from '../events/GameEventBus';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

export class HeatmapService {
  public static calculateInfluence(pos: Position): HeatmapData {
    const heatmap: HeatmapData = {};
    
    // Initialize empty heatmap
    for (const f of FILES) {
      for (const r of RANKS) {
        heatmap[`${f}${r}`] = { whiteInfluence: 0, blackInfluence: 0 };
      }
    }

    // A simple influence model: count how many pieces of each color attack a square
    // In chessops, pos.board has pieces. We can iterate over all squares 0..63
    for (let sq = 0; sq < 64; sq++) {
      const piece = pos.board.get(sq);
      if (piece) {
        const color = piece.color;
        // get attacks for this piece on this square
        const attackedSquares = attacks(piece, sq as Square, pos.board.occupied);
        
        // Convert SquareSet to array of squares and update heatmap
        for (const targetSq of attackedSquares) {
          const file = FILES[targetSq % 8];
          const rank = RANKS[Math.floor(targetSq / 8)];
          const squareName = `${file}${rank}`;
          
          if (color === 'white') {
            heatmap[squareName].whiteInfluence += 1;
          } else {
            heatmap[squareName].blackInfluence += 1;
          }
        }
      }
    }

    return heatmap;
  }
}
