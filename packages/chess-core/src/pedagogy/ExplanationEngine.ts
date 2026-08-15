import { MoveRecord } from './types';
import { GroqAPI } from './GroqAPI';

import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';

export class ExplanationEngine {
  private static readonly SYSTEM_PROMPT = `# Rôle
Tu es ChessCoach, un entraîneur d’échecs francophone, clair, rigoureux et pédagogique.
Ta mission est d’expliquer une analyse déjà calculée par Stockfish à un joueur humain. Tu ne remplaces pas Stockfish : tu interprètes uniquement les informations reçues.

# Sources de vérité
Les seules sources fiables sont les données JSON reçues (position FEN, coup, évaluation, meilleur coup, etc.). N’utilise aucune connaissance externe pour inventer un coup ou une tactique. Si une information n’existe pas, écris : « Les données disponibles ne permettent pas de l’affirmer. »

# Règles échiquéennes obligatoires
1. Le champ played_move.color indique obligatoirement qui a joué.
2. Ne parle d’une pièce que si les données (moved_piece, captured_piece) le confirment.
3. Ne dis jamais qu’un coup gagne du matériel ou force une suite sans donnée explicite.
4. Utilise uniquement les coups fournis dans played_move et best_move.
5. Une variation Stockfish est une illustration, explique uniquement son idée.

# Niveau pédagogique
Adapte la réponse au niveau intermédiaire (explique les plans et la sécurité du roi).
Garde une réponse concise, claire, en utilisant le format Markdown suivant.

# Format Markdown obligatoire
## Diagnostic
L'état de la position et le camp avantagé.
## Le coup joué
Qualité du coup et explication.
## Meilleure idée
Quel était le meilleur coup et pourquoi (si le coup joué n'était pas le meilleur).
## À retenir
Une leçon pratique très courte.`;

  private static roleToFr(role: string): string {
    const map: Record<string, string> = { pawn: 'Pion', knight: 'Cavalier', bishop: 'Fou', rook: 'Tour', queen: 'Dame', king: 'Roi' };
    return map[role] || 'Pièce';
  }

  public static async generateExplanation(record: MoveRecord): Promise<string> {
    const isWhite = record.color === 'white';
    
    let movedPiece = 'Inconnu';
    let capturedPiece = null;

    try {
      if (record.fenBefore) {
        const setup = parseFen(record.fenBefore).unwrap();
        const pos = Chess.fromSetup(setup).unwrap();
        const move = parseSan(pos, record.san);
        if (move && 'from' in move) {
          const fromPiece = pos.board.get(move.from);
          if (fromPiece) movedPiece = this.roleToFr(fromPiece.role);
          
          const toPiece = pos.board.get(move.to);
          if (toPiece) {
            capturedPiece = this.roleToFr(toPiece.role);
          } else if (fromPiece && fromPiece.role === 'pawn' && move.to === pos.epSquare) {
            capturedPiece = 'Pion (en passant)';
          }
        }
      }
    } catch (e) {}

    // Préparation des données JSON strictes pour le prompt
    const contextData = {
      fen_before: record.fenBefore,
      played_move: {
        san: record.san,
        color: record.color,
        moved_piece: movedPiece,
        captured_piece: capturedPiece,
        is_check: record.san.includes('+')
      },
      side_to_move_after: isWhite ? 'black' : 'white',
      evaluation_before: record.cpBefore !== undefined ? (record.cpBefore / 100).toFixed(2) : null,
      evaluation_after: record.cpAfter !== undefined ? (record.cpAfter / 100).toFixed(2) : null,
      evaluation_loss_cp: (record.cpBefore !== undefined && record.cpAfter !== undefined) ? Math.abs(record.cpAfter - record.cpBefore) : null,
      move_classification: record.classification,
      best_move: record.bestMove || null,
      player_level: 'intermédiaire'
    };

    const prompt = `Analyse cette position en respectant STRICTEMENT ton System Prompt et le format Markdown attendu.

DONNÉES JSON :
\`\`\`json
${JSON.stringify(contextData, null, 2)}
\`\`\``;

    return await GroqAPI.fetchChatCompletion(prompt, this.SYSTEM_PROMPT);
  }
}
