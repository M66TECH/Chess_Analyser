import { EngineEvaluation } from '../events/GameEventBus';

export class EngineParser {
  /**
   * Parse une ligne UCI "info depth … score cp/mate … pv …"
   * Retourne null si la ligne n'est pas une info de score.
   * M5 — Les scores upperbound/lowerbound sont ignorés (non exacts).
   * M4 — multipv NaN est traité en fallback à 1.
   */
  public static parseUciInfo(infoStr: string): EngineEvaluation | null {
    if (!infoStr.includes('info') || !infoStr.includes('score')) return null;

    const parts = infoStr.trim().split(/\s+/);
    const depthIndex = parts.indexOf('depth');
    const scoreIndex = parts.indexOf('score');
    const pvIndex = parts.indexOf('pv');
    const multiPvIndex = parts.indexOf('multipv');

    if (depthIndex === -1 || scoreIndex === -1) return null;

    const depth = parseInt(parts[depthIndex + 1], 10);
    if (isNaN(depth)) return null;

    const scoreType = parts[scoreIndex + 1];

    // M5 — Ignorer les bounds non exacts
    if (scoreType === 'upperbound' || scoreType === 'lowerbound') return null;

    const scoreValue = parseInt(parts[scoreIndex + 2], 10);
    if (isNaN(scoreValue)) return null;

    // M4 — Valider multipv, fallback à 1 si NaN
    const rawMultiPv = multiPvIndex !== -1 ? parseInt(parts[multiPvIndex + 1], 10) : 1;
    const multiPv = isNaN(rawMultiPv) ? 1 : rawMultiPv;

    const evaluation: EngineEvaluation = { depth, pv: [], multiPv };

    if (scoreType === 'cp') {
      evaluation.cp = scoreValue;
    } else if (scoreType === 'mate') {
      evaluation.mate = scoreValue;
    } else {
      // Type de score inconnu
      return null;
    }

    if (pvIndex !== -1) {
      evaluation.pv = parts.slice(pvIndex + 1).filter(t => t.trim().length > 0);
    }

    return evaluation;
  }

  /**
   * E3 — Parse la ligne UCI "bestmove e2e4 ponder e7e5"
   * Retourne le meilleur coup UCI, ou null si la ligne est invalide.
   */
  public static parseBestMove(msg: string): string | null {
    if (!msg.startsWith('bestmove')) return null;
    const parts = msg.trim().split(/\s+/);
    // bestmove (none) signifie qu'il n'y a pas de coup légal
    if (parts.length < 2 || parts[1] === '(none)') return null;
    return parts[1];
  }
}
