import type { MoveRecord, GameStats, GameClassificationCounts, RecurrentTheme } from '../pedagogy/types';
import { AccuracyScore } from './AccuracyScore';
import { phaseAccuracies } from './LichessAccuracy';
import { uciToSan } from '../utils/san';
import { ExplanationEngine } from '../pedagogy/ExplanationEngine';

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
    const isUnitScale =
      records.length > 0 &&
      records.every(
        (r) => Math.abs(r.winProbBefore) <= 1.001 && Math.abs(r.winProbAfter) <= 1.001
      );
    let maxSwingPct = -1;
    let criticalRecord: MoveRecord | null = null;

    for (const r of records) {
      const rawSwing = Math.abs(r.winProbBefore - r.winProbAfter);
      const swingPct = isUnitScale ? rawSwing * 50 : rawSwing;
      if (
        swingPct > maxSwingPct &&
        (r.classification === 'blunder' ||
          r.classification === 'mistake' ||
          r.classification === 'brilliant')
      ) {
        maxSwingPct = swingPct;
        criticalRecord = r;
      }
    }

    if (criticalRecord) {
      const who = criticalRecord.color === 'white' ? 'Blancs' : 'Noirs';
      const bestSan = criticalRecord.bestMove
        ? uciToSan(criticalRecord.fenBefore, criticalRecord.bestMove) ?? criticalRecord.bestMove
        : undefined;
      const bestMoveSentence = bestSan ? ` Coup recommandé : ${bestSan}.` : '';
      const desc =
        criticalRecord.classification === 'brilliant'
          ? `Coup de génie des ${who} avec ${criticalRecord.san} qui scelle le gain.`
          : `Tournant du match au coup ${Math.floor(criticalRecord.moveNumber)} : ${criticalRecord.san} (${who}) a coûté ${Math.round(maxSwingPct)}% de chances.${bestMoveSentence}`;

      baseStats.criticalMoment = {
        moveNumber: criticalRecord.moveNumber,
        color: criticalRecord.color,
        san: criticalRecord.san,
        playedMove: criticalRecord.playedMove,
        bestMove: criticalRecord.bestMove,
        fenBefore: criticalRecord.fenBefore,
        winDrop: maxSwingPct / 100,
        cpBefore: criticalRecord.cpBefore,
        cpAfter: criticalRecord.cpAfter,
        description: desc,
      };
    }

    // 4. Détection des motifs récurrents d'erreur (I1)
    const recurrentThemes = this.extractRecurrentThemes(records);
    baseStats.recurrentThemes = recurrentThemes;

    // 5. Synthèse pédagogique globale (Takeaway)
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

    const priorityAdvice: string[] = [];
    if (recurrentThemes.white.length > 0) {
      priorityAdvice.push(`Blancs : vigilance sur ${recurrentThemes.white[0].theme.toLowerCase()} (${recurrentThemes.white[0].count} fois)`);
    }
    if (recurrentThemes.black.length > 0) {
      priorityAdvice.push(`Noirs : vigilance sur ${recurrentThemes.black[0].theme.toLowerCase()} (${recurrentThemes.black[0].count} fois)`);
    }
    if (priorityAdvice.length > 0) {
      takeawayText += ` ${priorityAdvice.join(' ; ')}.`;
    }

    baseStats.takeaway = takeawayText;

    return baseStats;
  }

  /**
   * I1: Agrégation causale des motifs récurrents d'erreur basée sur
   * les faits tactiques certifiés (pièces en prise, clouages, séquences de mat).
   */
  private static extractRecurrentThemes(records: MoveRecord[]): {
    white: RecurrentTheme[];
    black: RecurrentTheme[];
  } {
    const errorClasses = new Set(['blunder', 'mistake', 'inaccuracy']);
    const stats = {
      white: { undefended: 0, pins: 0, tacticalLoss: 0, mateSequence: 0 },
      black: { undefended: 0, pins: 0, tacticalLoss: 0, mateSequence: 0 },
    };

    for (const r of records) {
      if (!errorClasses.has(r.classification)) continue;
      const target = stats[r.color];
      if (r.mateSequence === 'created') {
        target.mateSequence++;
      }
      try {
        const facts = ExplanationEngine.extractTacticalFacts(r);
        if (facts) {
          if (facts.newly_undefended_own_pieces.length > 0) {
            target.undefended++;
          }
          if (facts.new_pins_against_player.length > 0) {
            target.pins++;
          }
          if (facts.material_delta_in_pv < 0) {
            target.tacticalLoss++;
          }
        }
      } catch {
        // Ignorer silencieusement si la position ne peut pas être analysée
      }
    }

    const buildThemesForColor = (colorStats: typeof stats['white']): RecurrentTheme[] => {
      const themes: RecurrentTheme[] = [];
      if (colorStats.undefended >= 2) {
        themes.push({
          theme: 'Pièces non défendues',
          count: colorStats.undefended,
          description: `${colorStats.undefended} coups ont laissé des pièces en prise directe sans protection.`,
        });
      }
      if (colorStats.pins >= 2) {
        themes.push({
          theme: 'Clouages subis',
          count: colorStats.pins,
          description: `${colorStats.pins} erreurs résultent de clouages tactiques non anticipés.`,
        });
      }
      if (colorStats.tacticalLoss >= 2) {
        themes.push({
          theme: 'Pertes matérielles forcées',
          count: colorStats.tacticalLoss,
          description: `${colorStats.tacticalLoss} coups concèdent une perte matérielle nette dans la suite adverse.`,
        });
      }
      if (colorStats.mateSequence >= 1) {
        themes.push({
          theme: 'Réseau de mat concédé',
          count: colorStats.mateSequence,
          description: 'Coup permettant un mat forcé pour l’adversaire.',
        });
      }
      return themes;
    };

    return {
      white: buildThemesForColor(stats.white),
      black: buildThemesForColor(stats.black),
    };
  }
}
