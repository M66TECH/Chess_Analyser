// Placeholder for future Threat Detection (hanging pieces, forks, etc.)
import { Position } from 'chessops/chess';

export class ThreatService {
  public static detectThreats(pos: Position) {
    return {
      hangingPieces: [],
      tacticalMotifs: []
    };
  }
}
