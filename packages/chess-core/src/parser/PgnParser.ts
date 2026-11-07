/**
 * E5 â€” ImplÃ©mentation rÃ©elle du parsing PGN via chessops/pgn.
 * Retourne les coups UCI pour permettre leur rejeu dans GameManager.loadPgn().
 */
import { parsePgn, PgnNodeData } from 'chessops/pgn';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { parseFen } from 'chessops/fen';
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
   * Supporte les PGN standards (pas de variantes â€” seule la ligne principale est lue).
   */
  static parse(pgn: string): PgnParseResult {
    if (!pgn || pgn.trim().length === 0) {
      return { success: false, headers: {}, moves: [], error: 'PGN vide' };
    }

    try {
      const games = parsePgn(pgn);
      if (!games || games.length === 0) {
        return { success: false, headers: {}, moves: [], error: 'Aucune partie trouvÃ©e dans le PGN' };
      }

      const game = games[0];

      // Extraire les en-tÃªtes
      const headers: Record<string, string> = {};
      if (game.headers) {
        for (const [key, value] of game.headers) {
          headers[key] = value;
        }
      }

      // Construire la position de dÃ©part (FEN personnalisÃ© si prÃ©sent)
      const setupFen = headers['FEN'];
      const startPosition = (() => {
        if (!setupFen) return Chess.default();
        try {
          return Chess.fromSetup(parseFen(setupFen).unwrap()).unwrap();
        } catch {
          return Chess.default();
        }
      })();
      const pos = startPosition;

      // Parcourir la ligne principale du PGN et convertir SAN â†’ UCI
      const uciMoves: string[] = [];
      let node = game.moves;

      while (node.children.length > 0) {
        const child = node.children[0];
        const data: PgnNodeData = child.data;
        const san = data.san;

        // Les commentaires de variante ("{}" ou "*") ne sont pas des coups
        if (!san || san === '*' || san.startsWith('{')) break;

        try {
          const move = parseSan(pos, san);
          if (!move) break;
          uciMoves.push(makeUci(move));
          pos.play(move);
        } catch {
          // Coup illÃ©gal ou SAN invalide â€” on s'arrÃªte ici
          break;
        }

        node = child;
      }

      if (uciMoves.length === 0) {
        return { success: false, headers, moves: [], error: 'Aucun coup valide trouvÃ© dans le PGN' };
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
    if (records.length === 0) {
      return '[Event "Chess Analyzer Export"]\n[Site "Local"]\n[Result "*"]\n\n*\n';
    }

    let pgn = '[Event "Chess Analyzer Export"]\n';
    pgn += '[Site "Local"]\n';
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '.');
    pgn += `[Date "${date}"]\n`;
    pgn += '[Round "-"]\n[White "White"]\n[Black "Black"]\n';

    // Position de dÃ©part personnalisÃ©e : sans SetUp/FEN, le PGN serait
    // illisible (les coups ne correspondraient pas Ã  la position standard).
    const standardStart = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const startFen = records[0].fenBefore;
    if (startFen !== standardStart) {
      pgn += `[SetUp "1"]\n[FEN "${startFen}"]\n`;
    }
    pgn += '[Result "*"]\n\n';

    // Tokens assemblÃ©s puis repliÃ©s UNIQUEMENT entre tokens : couper au milieu
    // d'un commentaire `{ ... }` corromprait le PGN.
    const tokens: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const isWhite = r.color === 'white';

      if (isWhite) {
        tokens.push(`${Math.floor(r.moveNumber)}.`);
      } else if (i === 0 || records[i - 1].color !== 'white') {
        tokens.push(`${Math.floor(r.moveNumber)}...`);
      }

      let move = r.san;
      if (r.classification === 'blunder') move += '??';
      else if (r.classification === 'mistake') move += '?';
      else if (r.classification === 'inaccuracy') move += '?!';
      tokens.push(move);

      const comments: string[] = [];
      // `[%eval ...]` : convention Lichess, en pions du point de vue des Blancs.
      if (r.mateAfter !== undefined) {
        // `#0` n'est pas une notation PGN valide : un mat Â« nul Â» est omis.
        if (r.mateAfter !== 0) {
          const whitePovMate = r.color === 'white' ? -r.mateAfter : r.mateAfter;
          comments.push(`[%eval #${whitePovMate}]`);
        }
      } else if (r.cpAfter !== undefined) {
        comments.push(`[%eval ${(r.cpAfter / 100).toFixed(2)}]`);
      }

      if (r.classification === 'blunder' || r.classification === 'mistake' || r.classification === 'inaccuracy') {
        const textClass = r.classification === 'blunder' ? 'Blunder' : r.classification === 'mistake' ? 'Mistake' : 'Inaccuracy';
        const best = r.bestMove && r.bestMove !== r.playedMove ? `${r.bestMove} was best.` : '';
        comments.push(`${textClass}. ${best}`.trim());
      }

      if (comments.length > 0) {
        tokens.push(`{ ${comments.join(' ')} }`);
      }
    }

    // Repli Ã  ~80 colonnes, entre tokens.
    let line = '';
    for (const token of tokens) {
      if (line.length > 0 && line.length + token.length + 1 > 80) {
        pgn += line + '\n';
        line = token;
      } else {
        line = line.length > 0 ? `${line} ${token}` : token;
      }
    }
    if (line.length > 0) pgn += line + '\n';

    // Le résultat doit suivre la ligne de coups SANS ligne vide : `…\n\n*\n`
    // fait parser 2 parties par chessops (le `*` isolé est lu comme une
    // seconde partie vide).
    pgn += '*\n';
    return pgn;
  }
}
