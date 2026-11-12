import type { MoveRecord } from './types';
import { uciToSan } from '../utils/san';
import { MotifEngine } from './MotifEngine';

export interface TacticalPuzzle {
  id: string;
  moveNumber: number;
  color: 'white' | 'black';
  fen: string;
  blunderUci: string;
  blunderSan: string;
  solutionUci: string;
  solutionSan: string;
  solutionPv: string[];
  severity: 'blunder' | 'mistake';
  theme: string;
  hint: string;
  coachExplanation?: string;
  centipawnLoss: number;
}

export interface ProgressiveHints {
  hint1: { originSquare: string; text: string };
  hint2: { theme: string; text: string };
  hint3: { solutionSan: string; text: string };
}

/**
 * O18 / A31 : Génère les 3 indices progressifs pour un coup à retenter :
 * 1. Case de départ de la pièce
 * 2. Motif tactique
 * 3. Solution directe
 */
export function getProgressiveHints(record: MoveRecord): ProgressiveHints {
  const bestUci = record.bestMove ?? '';
  const originSquare = bestUci.length >= 2 ? bestUci.slice(0, 2) : '?';
  const bestSan = bestUci ? (uciToSan(record.fenBefore, bestUci) ?? bestUci) : 'inconnu';
  const { theme, hint } = identifyTacticalTheme(record.fenBefore);

  return {
    hint1: {
      originSquare,
      text: `Indice 1/3 (Pièce) : La bonne pièce se situe sur la case ${originSquare.toUpperCase()}.`,
    },
    hint2: {
      theme,
      text: `Indice 2/3 (Motif) : ${theme} — ${hint}`,
    },
    hint3: {
      solutionSan: bestSan,
      text: `Indice 3/3 (Solution) : Jouez ${bestSan}.`,
    },
  };
}

/**
 * Détermine le motif tactique prédominant d'une position d'erreur à l'aide de MotifEngine.
 */
function identifyTacticalTheme(fenBefore: string): { theme: string; hint: string } {
  try {
    const motifs = MotifEngine.analyzeFen(fenBefore);
    if (motifs) {
      if (motifs.checkable.length > 0) {
        return {
          theme: 'Attaque sur le Roi / Échec',
          hint: 'Le Roi adverse est exposé. Cherchez un échec décisif ou une menace directe de mat.',
        };
      }

      if (motifs.pins.length > 0) {
        return {
          theme: 'Clouage tactique',
          hint: 'Une pièce adverse est clouée. Exploitez son manque de mobilité !',
        };
      }

      if (motifs.undefended.length > 0) {
        return {
          theme: 'Pièce non protégée',
          hint: 'Une pièce importante manque de protection. Repérez la cible vulnérable.',
        };
      }
    }
  } catch {
    // Repli sûr en cas d'analyse complexe
  }

  return {
    theme: 'Initiative & Précision',
    hint: 'Améliorez l’activité de vos pièces sans concéder de faiblesse tactique.',
  };
}

/**
 * Extrait les exercices d'entraînement tactique (« puzzles ») à partir des gaffes
 * et erreurs commises dans une partie analysée.
 *
 * @param records Liste des coups analysés de la partie
 * @returns Liste de puzzles triés par sévérité et impact tactique
 */
export function extractPuzzlesFromGame(records: MoveRecord[]): TacticalPuzzle[] {
  const eligible = records.filter(
    (r) => (r.classification === 'blunder' || r.classification === 'mistake') && Boolean(r.bestMove)
  );

  const puzzles: TacticalPuzzle[] = [];

  for (let i = 0; i < eligible.length; i++) {
    const rec = eligible[i];
    const bestMoveUci = rec.bestMove!;
    const bestMoveSan = uciToSan(rec.fenBefore, bestMoveUci) ?? bestMoveUci;

    const { theme, hint } = identifyTacticalTheme(rec.fenBefore);

    const cpLoss = Math.max(0, rec.cpBefore - rec.cpAfter);

    puzzles.push({
      id: `puzzle-${rec.nodeId || i + 1}`,
      moveNumber: rec.moveNumber,
      color: rec.color,
      fen: rec.fenBefore,
      blunderUci: rec.playedMove,
      blunderSan: rec.san,
      solutionUci: bestMoveUci,
      solutionSan: bestMoveSan,
      solutionPv: rec.bestPv ?? [bestMoveUci],
      severity: rec.classification as 'blunder' | 'mistake',
      theme,
      hint,
      coachExplanation: rec.coachCard ? `${rec.coachCard.headline} ${rec.coachCard.takeaway}` : rec.explanation,
      centipawnLoss: cpLoss,
    });
  }

  // Trier par sévérité (gaffes en premier), puis par perte de centipions décroissante
  puzzles.sort((a, b) => {
    if (a.severity === 'blunder' && b.severity !== 'blunder') return -1;
    if (a.severity !== 'blunder' && b.severity === 'blunder') return 1;
    return b.centipawnLoss - a.centipawnLoss;
  });

  return puzzles;
}
