import type { MoveRecord, GameStats, GameClassificationCounts } from '../pedagogy/types';
import { AccuracyScore } from './AccuracyScore';
import { phaseAccuracies } from './LichessAccuracy';
import { uciToSan } from '../utils/san';

/**
 * Service de synthèse et de rapport de match global (P3.16).
 *
 * Consolide :
 * - Précisions par phase (ouverture, milieu, finale) selon la détection Lichess
 * - Distribution détaillée des classifications (!!, !, best, excellent, good, ?!, ?, ??)
 * - Moment critique / tournant décisif du match
 * - Enseignement clé pédagogique (takeaway).
 */
export class MatchSummaryService {
  public static generateSummary(records: MoveRecord[]): GameStats {
    const baseStats = AccuracyScore.computeGameStats(records);
    if (records.length === 0) return baseStats;

    const startColor = records[0].color;
    const cps = records.map((r) => r.cpAfter);
    const fens = records.map((r) => r.fenAfter);

    // 1. Précision par phase (Ouverture, Milieu, Finale)
    const phases = phaseAccuracies(cps, fens, startColor);
    baseStats.phaseStats = {
      opening: phases.opening
        ? {
            white: Math.round(phases.opening.white * 10) / 10,
            black: Math.round(phases.opening.black * 10) / 10,
          }
        : undefined,
      middlegame: phases.middlegame
        ? {
            white: Math.round(phases.middlegame.white * 10) / 10,
            black: Math.round(phases.middlegame.black * 10) / 10,
          }
        : undefined,
      endgame: phases.endgame
        ? {
            white: Math.round(phases.endgame.white * 10) / 10,
            black: Math.round(phases.endgame.black * 10) / 10,
          }
        : undefined,
    };

    // 2. Décompte complet des 9 classifications
    const counts = {
      white: {
        brilliant: 0,
        great: 0,
        best: 0,
        excellent: 0,
        good: 0,
        inaccuracy: 0,
        mistake: 0,
        blunder: 0,
        book: 0,
      },
      black: {
        brilliant: 0,
        great: 0,
        best: 0,
        excellent: 0,
        good: 0,
        inaccuracy: 0,
        mistake: 0,
        blunder: 0,
        book: 0,
      },
    };

    for (const r of records) {
      const target = counts[r.color];
      const cls = r.classification;
      if (cls in target) {
        target[cls as keyof GameClassificationCounts]++;
      }
      if (cls !== 'book' && (r.theory?.status === 'confirmed' || r.theory?.isTheory)) {
        target.book++;
      }
    }
    baseStats.classificationCounts = counts;

    // 3. Identification du tournant décisif (Critical Moment)
    let maxSwing = -1;
    let criticalRecord: MoveRecord | null = null;

    for (const r of records) {
      const swing = Math.abs(r.winProbBefore - r.winProbAfter);
      if (
        swing > maxSwing &&
        (r.classification === 'blunder' ||
          r.classification === 'mistake' ||
          r.classification === 'brilliant')
      ) {
        maxSwing = swing;
        criticalRecord = r;
      }
    }

    if (criticalRecord) {
      const who = criticalRecord.color === 'white' ? 'Blancs' : 'Noirs';
      const bestSan = criticalRecord.bestMove
        ? uciToSan(criticalRecord.fenBefore, criticalRecord.bestMove) ?? criticalRecord.bestMove
        : undefined;
      const desc =
        criticalRecord.classification === 'brilliant'
          ? `Coup de génie des ${who} avec ${criticalRecord.san} qui scelle le gain.`
          : `Tournant du match au coup ${Math.floor(criticalRecord.moveNumber)} : ${criticalRecord.san} (${who}) a coûté ${Math.round(maxSwing)}% de chances. Coup recommandé : ${bestSan}.`;

      baseStats.criticalMoment = {
        moveNumber: criticalRecord.moveNumber,
        color: criticalRecord.color,
        san: criticalRecord.san,
        playedMove: criticalRecord.playedMove,
        bestMove: criticalRecord.bestMove,
        fenBefore: criticalRecord.fenBefore,
        winDrop: maxSwing / 100,
        cpBefore: criticalRecord.cpBefore,
        cpAfter: criticalRecord.cpAfter,
        description: desc,
      };
    }

    // 4. Synthèse pédagogique globale (Takeaway)
    const whiteAcc = baseStats.accuracy.white;
    const blackAcc = baseStats.accuracy.black;
    const totalBlunders = baseStats.blunders.white + baseStats.blunders.black;

    let takeawayText = '';
    if (totalBlunders === 0 && (whiteAcc >= 85 || blackAcc >= 85)) {
      takeawayText = 'Partie d’un excellent niveau technique, solide et sans gaffe majeure des deux côtés.';
    } else if (baseStats.criticalMoment) {
      takeawayText = baseStats.criticalMoment.description;
    } else {
      takeawayText = `Partie conclue avec une précision globale de ${whiteAcc}% pour les Blancs et ${blackAcc}% pour les Noirs.`;
    }
    baseStats.takeaway = takeawayText;

    return baseStats;
  }
}
