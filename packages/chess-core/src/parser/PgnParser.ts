/**
 * E5 — Implémentation réelle du parsing PGN via chessops/pgn.
 * Retourne les coups UCI pour permettre leur rejeu dans GameManager.loadPgn().
 */
import { parsePgn, startingPosition, PgnNodeData } from 'chessops/pgn';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import type { MoveRecord } from '../pedagogy/types';

export interface PgnParseResult {
  success: boolean;
  headers: Record<string, string>;
  moves: string[];   // UCI moves
  error?: string;
}

export class PgnParser {
  /**
   * Parse un texte PGN et retourne les coups UCI dans l'ordre.
   * Supporte les PGN standards (pas de variantes — seule la ligne principale est lue).
   */
  static parse(pgn: string): PgnParseResult {
    if (!pgn || pgn.trim().length === 0) {
      return { success: false, headers: {}, moves: [], error: 'PGN vide' };
    }

    try {
      const games = parsePgn(pgn);
      if (!games || games.length === 0) {
        return { success: false, headers: {}, moves: [], error: 'Aucune partie trouvée dans le PGN' };
      }

      const game = games[0];

      // Extraire les en-têtes
      const headers: Record<string, string> = {};
      if (game.headers) {
        for (const [key, value] of game.headers) {
          headers[key] = value;
        }
      }

      // Construire la position de départ (FEN personnalisé si présent)
      const setupFen = headers['FEN'];
      let pos: Chess;
      try {
        pos = setupFen ? startingPosition(game.headers!).unwrap() as Chess : Chess.default();
      } catch {
        pos = Chess.default();
      }

      // Parcourir la ligne principale du PGN et convertir SAN → UCI
      const uciMoves: string[] = [];
      let node = game.moves;

      while (node.children.length > 0) {
        const child = node.children[0];
        const data: PgnNodeData = child.data;
        const san = data.san;

        try {
          const move = parseSan(pos, san);
          if (!move) break;
          uciMoves.push(makeUci(move));
          pos.play(move);
        } catch {
          // Coup illégal ou SAN invalide — on s'arrête ici
          break;
        }

        node = child;
      }

      if (uciMoves.length === 0) {
        return { success: false, headers, moves: [], error: 'Aucun coup valide trouvé dans le PGN' };
      }

      return { success: true, headers, moves: uciMoves };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue lors du parsing PGN';
      return { success: false, headers: {}, moves: [], error: msg };
    }
  }

  /**
   * Génère un fichier PGN annoté à partir des analyses de Stockfish.
   */
  static exportAnnotatedPgn(records: MoveRecord[]): string {
    let pgn = '[Event "Chess Analyzer Export"]\n';
    pgn += '[Site "Local"]\n';
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '.');
    pgn += `[Date "${date}"]\n`;
    pgn += '[Round "-"]\n[White "White"]\n[Black "Black"]\n[Result "*"]\n\n';

    let line = '';

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const isWhite = r.color === 'white';
      
      if (isWhite) {
        line += `${Math.floor(r.moveNumber)}. `;
      } else if (i === 0 || records[i-1].color !== 'white') {
        // Black's move but no preceding white move printed
        line += `${Math.floor(r.moveNumber)}... `;
      }

      // 1. Move SAN
      line += r.san;

      // 2. Glyph
      if (r.classification === 'blunder') line += '??';
      else if (r.classification === 'mistake') line += '?';
      else if (r.classification === 'inaccuracy') line += '?!';

      line += ' ';

      // 3. Comments (Eval + Text)
      const comments: string[] = [];
      if (r.cpAfter !== undefined) {
        if (r.mateAfter !== undefined) {
          comments.push(`[%eval #${r.mateAfter}]`);
        } else {
          comments.push(`[%eval ${(r.cpAfter / 100).toFixed(2)}]`);
        }
      }

      if (r.classification === 'blunder' || r.classification === 'mistake' || r.classification === 'inaccuracy') {
        const textClass = r.classification === 'blunder' ? 'Blunder' : r.classification === 'mistake' ? 'Mistake' : 'Inaccuracy';
        const best = r.bestMove ? `${r.bestMove} was best.` : '';
        comments.push(`${textClass}. ${best}`.trim());
      }

      if (comments.length > 0) {
        line += `{ ${comments.join(' ')} } `;
      }

      // Line wrap to ~80 chars
      if (line.length > 70) {
        pgn += line.trim() + '\n';
        line = '';
      }
    }

    if (line.length > 0) {
      pgn += line.trim() + '\n';
    }

    pgn += '\n*\n';
    return pgn;
  }
}
