import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { makeSquare } from 'chessops/util';
import type { MoveRecord } from './types';
import type { InsightKind } from './ExplanationContext';
import { uciToShape, type BoardShape } from '../utils/san';
import { MotifEngine } from './MotifEngine';

/**
 * Calcule de manière 100% déterministe les flèches et surbrillances à afficher sur l'échiquier
 * lors du survol d'une section pédagogique du Coach IA.
 *
 * Zéro hallucination : aucune coordonnée n'est demandée au modèle de langage.
 * Tous les vecteurs sont dérivés des faits tactiques réels du moteur et de la position.
 */
export function computeDeterministicHighlights(
  insightKind: InsightKind,
  record: MoveRecord
): BoardShape[] {
  const shapes: BoardShape[] = [];
  const playedMove = (record as { uci?: string }).uci ?? record.playedMove;

  switch (insightKind) {
    case 'played_move': {
      // Surligne le coup effectivement joué
      if (playedMove) {
        const shape = uciToShape(playedMove);
        if (shape) {
          shapes.push({ ...shape, brush: 'blue' });
          shapes.push({ orig: shape.orig, brush: 'paleBlue' });
        }
      }
      break;
    }

    case 'missed_move': {
      // Surligne le meilleur coup manqué (flèche verte)
      if (record.bestMove) {
        const shape = uciToShape(record.bestMove);
        if (shape) {
          shapes.push({ ...shape, brush: 'green' });
          shapes.push({ orig: shape.orig, brush: 'paleGreen' });
        }
      }
      break;
    }

    case 'mistake': {
      // 1. Première réponse de réfutation adverse (flèche rouge)
      if (record.refutationPv && record.refutationPv.length > 0) {
        const shape = uciToShape(record.refutationPv[0]);
        if (shape) {
          shapes.push({ ...shape, brush: 'red' });
        }
      }

      // 2. Pièces en prise non protégées après le coup
      try {
        const setup = parseFen(record.fenAfter).unwrap();
        const pos = Chess.fromSetup(setup).unwrap();

        const undefended = MotifEngine.detectUndefended(pos.board, pos.epSquare);
        for (const u of undefended) {
          shapes.push({ orig: makeSquare(u.square), brush: 'red' });
        }

        // 3. Clouages réels : flèche de la pièce clouante vers la pièce clouée
        const pins = MotifEngine.detectPins(pos.board);
        for (const p of pins) {
          shapes.push({
            orig: makeSquare(p.pinner),
            dest: makeSquare(p.pinned),
            brush: 'blue',
          });
        }
      } catch {
        // Fallback sûr en cas de position invalide
      }
      break;
    }

    case 'good_decision': {
      // Coup satisfaisant en vert
      if (playedMove) {
        const shape = uciToShape(playedMove);
        if (shape) {
          shapes.push({ ...shape, brush: 'green' });
        }
      }
      break;
    }

    case 'consequence': {
      // Suite adverse en réfutation (1er et 2e coups)
      if (record.refutationPv && record.refutationPv.length > 0) {
        const first = uciToShape(record.refutationPv[0]);
        if (first) shapes.push({ ...first, brush: 'red' });

        if (record.refutationPv.length > 1) {
          const second = uciToShape(record.refutationPv[1]);
          if (second) shapes.push({ ...second, brush: 'paleRed' });
        }
      }
      break;
    }
  }

  return shapes;
}
