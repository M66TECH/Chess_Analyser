/**
 * E5 & Phase 7/8 — Parsing PGN et export RAV récursif multi-branches.
 * Supporte la ligne principale ainsi que toutes les sous-variantes imbriquées (RAV).
 */
import { parsePgn, PgnNodeData, Node } from 'chessops/pgn';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { parseFen, makeFen } from 'chessops/fen';
import type { MoveRecord, MoveNode } from '../pedagogy/types';

export interface PgnParseResult {
  success: boolean;
  headers: Record<string, string>;
  moves: string[]; // UCI moves
  error?: string;
}

export interface PgnTreeParseResult {
  success: boolean;
  headers: Record<string, string>;
  initialFen: string;
  nodes: Map<string, MoveNode>;
  mainlineMoves: string[];
  error?: string;
}

export class PgnParser {
  /**
   * Parse un texte PGN complet avec toutes ses sous-variantes récursives (Lot 3).
   */
  static parseTree(pgn: string): PgnTreeParseResult {
    if (!pgn || pgn.trim().length === 0) {
      return { success: false, headers: {}, initialFen: '', nodes: new Map(), mainlineMoves: [], error: 'PGN vide' };
    }

    try {
      const normalizedPgn = PgnParser.normalizeFrenchPgn(pgn);
      const games = parsePgn(normalizedPgn);
      if (!games || games.length === 0) {
        return { success: false, headers: {}, initialFen: '', nodes: new Map(), mainlineMoves: [], error: 'Aucune partie trouvée dans le PGN' };
      }

      const game = games[0];
      const headers: Record<string, string> = {};
      if (game.headers) {
        for (const [key, value] of game.headers) {
          headers[key] = value;
        }
      }

      const setupFen = headers['FEN'];
      const standardStart = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      let startPos: Chess;
      let initialFen = standardStart;

      if (setupFen) {
        try {
          const parsed = parseFen(setupFen).unwrap();
          startPos = Chess.fromSetup(parsed).unwrap();
          initialFen = setupFen;
        } catch {
          startPos = Chess.default();
        }
      } else {
        startPos = Chess.default();
      }

      const nodes = new Map<string, MoveNode>();
      const mainlineMoves: string[] = [];
      let nextId = 1;

      // Parcours récursif pour explorer la ligne principale et toutes les sous-branches RAV (children[1..n])
      const walk = (
        pgnNode: Node<PgnNodeData>,
        parentId: string | null,
        currentPos: Chess,
        isMainlineBranch: boolean
      ) => {
        for (let i = 0; i < pgnNode.children.length; i++) {
          const child = pgnNode.children[i];
          const san = child.data?.san;
          if (!san || san === '*' || san.startsWith('{')) continue;

          const branchPos = currentPos.clone();
          try {
            let move = parseSan(branchPos, san);
            if (!move) {
              const altSan = PgnParser.convertFrenchSanToInternational(san);
              if (altSan !== san) {
                move = parseSan(branchPos, altSan);
              }
            }
            if (!move) continue;

            const uci = makeUci(move);
            const fenBefore = makeFen(branchPos.toSetup());
            const turnColor = branchPos.turn === 'white' ? 'white' : 'black';
            const moveNumber = branchPos.fullmoves;

            branchPos.play(move);
            const fenAfter = makeFen(branchPos.toSetup());

            const isMainline = isMainlineBranch && i === 0;
            const nodeId = `node_${nextId++}`;

            const node: MoveNode = {
              id: nodeId,
              uci,
              san,
              fenBefore,
              fenAfter,
              moveNumber,
              color: turnColor,
              parentId,
              childrenIds: [],
              isMainline,
            };

            nodes.set(nodeId, node);

            if (parentId) {
              const p = nodes.get(parentId);
              if (p) p.childrenIds.push(nodeId);
            }

            if (isMainline) {
              mainlineMoves.push(uci);
            }

            // Récursion pour les coups enfants
            walk(child, nodeId, branchPos, isMainline);
          } catch {
            // Coup illégal ou non analysable
          }
        }
      };

      walk(game.moves, null, startPos, true);

      if (nodes.size === 0) {
        return { success: false, headers, initialFen, nodes, mainlineMoves: [], error: 'Aucun coup valide trouvé dans le PGN' };
      }

      return {
        success: true,
        headers,
        initialFen,
        nodes,
        mainlineMoves,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue lors du parsing PGN';
      return { success: false, headers: {}, initialFen: '', nodes: new Map(), mainlineMoves: [], error: msg };
    }
  }

  /**
   * Parse un texte PGN et retourne les coups UCI de la ligne principale.
   * Rétro-compatible avec l'ensemble des tests et appelants.
   */
  static parse(pgn: string): PgnParseResult {
    const res = PgnParser.parseTree(pgn);
    return {
      success: res.success,
      headers: res.headers,
      moves: res.mainlineMoves,
      error: res.error,
    };
  }

  /**
   * Génère un fichier PGN annoté à partir des analyses de Stockfish.
   * Supporte l'export complet de variantes imbriquées (RAV) si un arbre est fourni.
   */
  static exportAnnotatedPgn(
    records: MoveRecord[],
    tree?: { nodes: Map<string, MoveNode>; initialFen?: string }
  ): string {
    if (records.length === 0 && (!tree || tree.nodes.size === 0)) {
      return '[Event "Chess Analyzer Export"]\n[Site "Local"]\n[Result "*"]\n\n*\n';
    }

    let pgn = '[Event "Chess Analyzer Export"]\n';
    pgn += '[Site "Local"]\n';
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '.');
    pgn += `[Date "${date}"]\n`;
    pgn += '[Round "-"]\n[White "White"]\n[Black "Black"]\n';

    const standardStart = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const startFen = tree?.initialFen ?? (records.length > 0 ? records[0].fenBefore : standardStart);
    if (startFen !== standardStart) {
      pgn += `[SetUp "1"]\n[FEN "${startFen}"]\n`;
    }
    pgn += '[Result "*"]\n\n';

    const recordsByNodeId = new Map<string, MoveRecord>();
    for (const r of records) {
      recordsByNodeId.set(r.nodeId, r);
    }

    const tokens: string[] = [];

    // Si un arbre est fourni avec des variantes
    if (tree && tree.nodes.size > 0) {
      const nodes = tree.nodes;
      const rootNodes = Array.from(nodes.values()).filter((n) => n.parentId === null);

      const serializeBranch = (nodeId: string, isFirstInBranch: boolean): string[] => {
        const branchTokens: string[] = [];
        let currId: string | null = nodeId;
        let first = isFirstInBranch;

        while (currId) {
          const node = nodes.get(currId);
          if (!node) break;

          if (node.color === 'white') {
            branchTokens.push(`${Math.floor(node.moveNumber)}.`);
          } else if (first) {
            branchTokens.push(`${Math.floor(node.moveNumber)}...`);
          }
          first = false;

          let moveSan = node.san;
          const rec = recordsByNodeId.get(node.id);
          if (rec) {
            if (rec.classification === 'blunder') moveSan += '??';
            else if (rec.classification === 'mistake') moveSan += '?';
            else if (rec.classification === 'inaccuracy') moveSan += '?!';
          }
          branchTokens.push(moveSan);

          if (rec) {
            const comments: string[] = [];
            if (rec.mateAfter !== undefined && rec.mateAfter !== 0) {
              const whitePovMate = rec.color === 'white' ? -rec.mateAfter : rec.mateAfter;
              comments.push(`[%eval #${whitePovMate}]`);
            } else if (rec.cpAfter !== undefined) {
              comments.push(`[%eval ${(rec.cpAfter / 100).toFixed(2)}]`);
            }
            if (rec.classification === 'blunder' || rec.classification === 'mistake' || rec.classification === 'inaccuracy') {
              const textClass = rec.classification === 'blunder' ? 'Blunder' : rec.classification === 'mistake' ? 'Mistake' : 'Inaccuracy';
              const best = rec.bestMove && rec.bestMove !== rec.playedMove ? `${rec.bestMove} was best.` : '';
              comments.push(`${textClass}. ${best}`.trim());
            }
            if (comments.length > 0) {
              branchTokens.push(`{ ${comments.join(' ')} }`);
            }
          }

          // Variantes alternatives depuis ce même point (siblings childrenIds[1..n])
          if (node.childrenIds.length > 1) {
            for (let v = 1; v < node.childrenIds.length; v++) {
              const subTokens = serializeBranch(node.childrenIds[v], true);
              branchTokens.push(`(${subTokens.join(' ')})`);
            }
          }

          currId = node.childrenIds[0] ?? null;
        }
        return branchTokens;
      };

      if (rootNodes.length > 0) {
        tokens.push(...serializeBranch(rootNodes[0].id, false));
        for (let r = 1; r < rootNodes.length; r++) {
          const altRootTokens = serializeBranch(rootNodes[r].id, true);
          tokens.push(`(${altRootTokens.join(' ')})`);
        }
      }
    } else {
      // Export linéaire classique des records
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
        if (r.mateAfter !== undefined && r.mateAfter !== 0) {
          const whitePovMate = r.color === 'white' ? -r.mateAfter : r.mateAfter;
          comments.push(`[%eval #${whitePovMate}]`);
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
    }

    // Repli à ~80 colonnes, entre tokens
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

    pgn += '*\n';
    return pgn;
  }

  /**
   * P0.4 : Normalise un texte PGN pour convertir la notation échiquéenne française
   * en notation internationale standard (FIDE/PGN standard).
   *
   * Règles :
   * - Pièces : C -> N, F -> B, T -> R, D -> Q
   * - Roi : R -> K si le texte contient par ailleurs des marqueurs français indubitables (C, F, T, D)
   * - Promotions : =D -> =Q, =C -> =N, =F -> =B, =T -> =R
   * - Préserve les en-têtes [Key "Value"] et les commentaires { ... } / ; ...
   */
  public static normalizeFrenchPgn(pgn: string): string {
    const bodyWithoutHeadersOrComments = pgn
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\{[^\}]*\}/g, ' ')
      .replace(/;[^\n]*/g, ' ');

    const hasFrenchMarkers = /\b[CFTD][a-h1-8x=+#-]|=[CFTD]\b/.test(bodyWithoutHeadersOrComments);
    if (!hasFrenchMarkers) {
      return pgn;
    }

    return pgn.replace(
      /(\[[^\]]*\]|\{[^\}]*\}|;[^\n]*)|(\b[a-h][1-8]?x?[a-h][1-8](?:=[CFTD])?[+#]?|\b[a-h][1-8]=[CFTD][+#]?|\b[CFTDR][a-h1-8x=+#-]+)/g,
      (match, nonMove, moveToken) => {
        if (nonMove) return nonMove;
        if (!moveToken) return match;

        let converted = moveToken;
        if (/^C/.test(converted)) converted = 'N' + converted.slice(1);
        else if (/^F/.test(converted)) converted = 'B' + converted.slice(1);
        else if (/^T/.test(converted)) converted = 'R' + converted.slice(1);
        else if (/^D/.test(converted)) converted = 'Q' + converted.slice(1);
        else if (/^R/.test(converted)) converted = 'K' + converted.slice(1);

        converted = converted
          .replace(/=D/g, '=Q')
          .replace(/=C/g, '=N')
          .replace(/=F/g, '=B')
          .replace(/=T/g, '=R');

        return converted;
      }
    );
  }

  /**
   * P0.4 : Convertit un coup SAN individuel de la notation française vers la notation internationale.
   */
  public static convertFrenchSanToInternational(san: string): string {
    if (!san) return san;
    let converted = san;
    if (/^C/.test(converted)) converted = 'N' + converted.slice(1);
    else if (/^F/.test(converted)) converted = 'B' + converted.slice(1);
    else if (/^T/.test(converted)) converted = 'R' + converted.slice(1);
    else if (/^D/.test(converted)) converted = 'Q' + converted.slice(1);
    else if (/^R/.test(converted)) converted = 'K' + converted.slice(1);

    return converted
      .replace(/=D/g, '=Q')
      .replace(/=C/g, '=N')
      .replace(/=F/g, '=B')
      .replace(/=T/g, '=R');
  }
}
