import { MoveRecord } from './types';
import { GroqAPI } from './GroqAPI';

import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';

export class ExplanationEngine {
  private static readonly SYSTEM_PROMPT = `Tu es un grand maître international d'échecs et un coach réputé.
Ton rôle est de commenter le dernier coup joué par l'utilisateur en UNE SEULE PHRASE (10-20 mots maximum).
RÈGLES STRICTES CONTRE LES HALLUCINATIONS :
1. Tu ne vois pas l'échiquier. Base-toi UNIQUEMENT sur les faits fournis. Ne devine JAMAIS les pièces capturées si ce n'est pas spécifié.
2. Si le coup est une Gaffe (Blunder) et qu'il n'y a pas de capture, dis "Tu laisses une pièce vulnérable" ou "Tu donnes l'avantage".
3. Ne nomme les pièces que si elles sont explicitement mentionnées dans les faits.
4. Concentre-toi sur le concept stratégique déduit de l'évaluation du moteur.
5. Parle à la deuxième personne ("Tu").`;

  private static roleToFr(role: string): string {
    const map: Record<string, string> = { pawn: 'Pion', knight: 'Cavalier', bishop: 'Fou', rook: 'Tour', queen: 'Dame', king: 'Roi' };
    return map[role] || 'Pièce';
  }

  public static async generateExplanation(record: MoveRecord): Promise<string> {
    const isWhite = record.color === 'white';
    
    const classMap: Record<string, string> = {
      blunder: 'Gaffe (très mauvais)',
      mistake: 'Erreur',
      inaccuracy: 'Imprécision',
      good: 'Bon coup',
      excellent: 'Excellent coup',
      best: 'Meilleur coup',
      great: 'Superbe coup',
      brilliant: 'Coup brillant !',
      book: 'Coup théorique'
    };
    const classificationFr = classMap[record.classification] || 'Coup normal';

    let movedPiece = 'Une pièce';
    let capturedPiece = '';

    try {
      if (record.fenBefore) {
        const setup = parseFen(record.fenBefore).unwrap();
        const pos = Chess.fromSetup(setup).unwrap();
        const move = parseSan(pos, record.san);
        if (move) {
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
    } catch (e) {
      console.error('Erreur de parsing chessops pour Llama 3', e);
    }

    const isCheck = record.san.includes('+');

    let prompt = `Voici les FAITS MATHÉMATIQUES EXACTS de la position :\n`;
    prompt += `- Le joueur a joué : ${record.san}\n`;
    prompt += `- Ce coup déplace : ${movedPiece}\n`;
    if (capturedPiece) prompt += `- Ce coup CAPTURE : ${capturedPiece} adverse.\n`;
    if (isCheck) prompt += `- Ce coup met le roi adverse en ÉCHEC.\n`;
    
    if (record.cpBefore !== undefined && record.cpAfter !== undefined) {
      const evalBefore = (record.cpBefore / 100).toFixed(1);
      const evalAfter = (record.cpAfter / 100).toFixed(1);
      prompt += `- L'évaluation Stockfish passe de ${evalBefore} à ${evalAfter} (différence de ${(record.cpAfter - record.cpBefore) / 100} points).\n`;
    }

    prompt += `- Classification du coup : ${classificationFr}.\n`;

    if (record.bestMove && record.classification !== 'best' && record.classification !== 'book') {
      prompt += `- Stockfish recommandait plutôt de jouer : ${record.bestMove}.\n`;
    }

    prompt += `\nConsigne : Rédige ton analyse courte (une seule phrase dynamique) à partir de ces FAITS uniquement. Ne mentionne pas de pièces qui ne sont pas listées ci-dessus. :`;

    return await GroqAPI.fetchChatCompletion(prompt, this.SYSTEM_PROMPT);
  }
}
