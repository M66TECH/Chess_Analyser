import { EngineEvaluation } from '../events/GameEventBus';

export class EngineParser {
  // Parses a UCI info string and extracts evaluation
  public static parseUciInfo(infoStr: string): EngineEvaluation | null {
    if (!infoStr.includes('info') || !infoStr.includes('score')) return null;

    const parts = infoStr.split(' ');
    const depthIndex = parts.indexOf('depth');
    const scoreIndex = parts.indexOf('score');
    const pvIndex = parts.indexOf('pv');

    if (depthIndex === -1 || scoreIndex === -1) return null;

    const depth = parseInt(parts[depthIndex + 1], 10);
    const scoreType = parts[scoreIndex + 1];
    const scoreValue = parseInt(parts[scoreIndex + 2], 10);

    const evaluation: EngineEvaluation = { depth, pv: [] };

    if (scoreType === 'cp') {
      evaluation.cp = scoreValue;
    } else if (scoreType === 'mate') {
      evaluation.mate = scoreValue;
    }

    if (pvIndex !== -1) {
      evaluation.pv = parts.slice(pvIndex + 1);
    }

    return evaluation;
  }
}
