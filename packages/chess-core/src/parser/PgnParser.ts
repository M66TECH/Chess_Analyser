/**
 * E5 — Implémentation réelle du parsing PGN via chessops/pgn.
 * Retourne les coups UCI pour permettre leur rejeu dans GameManager.loadPgn().
 */
import { parsePgn, startingPosition, PgnNodeData } from 'chessops/pgn';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';

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
}
