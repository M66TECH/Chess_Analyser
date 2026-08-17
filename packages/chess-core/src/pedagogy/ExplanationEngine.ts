import { MoveRecord } from './types';
import { GroqAPI } from './GroqAPI';
import { uciToSan } from '../utils/san';

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
4. Utilise uniquement les coups fournis dans played_move.san et best_move.san (notation SAN).
5. Une variation Stockfish est une illustration, explique uniquement son idée.
6. Les évaluations evaluation_before / evaluation_after sont exprimées en pions du point de vue des Blancs : positif = avantage des Blancs, négatif = avantage des Noirs. Si le coup a été joué par les Noirs, interprète les signes en conséquence (ne dis pas que les Blancs sont avantagés quand les chiffres favorisent en réalité le camp joué).

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
    } catch {}

    // Préparation des données JSON strictes pour le prompt
    const isCheck = /[+#]$/.test(record.san);
    const bestMoveSan = record.bestMove ? uciToSan(record.fenBefore, record.bestMove) : null;
    // Perte de chances exprimée du point de vue du joueur qui vient de jouer
    const playerLossCp =
      record.cpBefore !== undefined && record.cpAfter !== undefined
        ? record.color === 'white'
          ? Math.max(0, record.cpBefore - record.cpAfter)
          : Math.max(0, record.cpAfter - record.cpBefore)
        : null;

    const contextData = {
      fen_before: record.fenBefore,
      played_move: {
        san: record.san,
        color: record.color,
        moved_piece: movedPiece,
        captured_piece: capturedPiece,
        is_check: isCheck,
      },
      side_to_move_before: record.color,
      side_to_move_after: isWhite ? 'black' : 'white',
      // POV Blanc : positif = avantage Blancs
      evaluation_before: record.cpBefore !== undefined ? (record.cpBefore / 100).toFixed(2) : null,
      evaluation_after: record.cpAfter !== undefined ? (record.cpAfter / 100).toFixed(2) : null,
      player_loss_cp: playerLossCp,
      move_classification: record.classification,
      best_move: {
        san: bestMoveSan,
        uci: record.bestMove || null,
      },
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
