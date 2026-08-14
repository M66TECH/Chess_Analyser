import { MoveRecord } from './types';
import { GroqAPI } from './GroqAPI';

export class ExplanationEngine {
  private static readonly SYSTEM_PROMPT = `Tu es un coach d'échecs expert, pédagogue et très concis (façon analyse Chess.com).
Ton but est de fournir UNE SEULE PHRASE (maximum 15-20 mots) pour commenter le coup qui vient d'être joué, en t'adressant directement au joueur (ex: "Tu développes ton cavalier et contrôles le centre.").
Adapte ton ton selon la classification du coup (Gaffe, Erreur, Imprécision, Bon coup, Excellent, Brillant).
Ne donne JAMAIS la suite des coups ou de variantes complexes.`;

  public static async generateExplanation(record: MoveRecord): Promise<string> {
    const isWhite = record.color === 'white';
    const playerStr = isWhite ? 'Les Blancs' : 'Les Noirs';
    
    // Translation of classification to French for the prompt
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

    let prompt = `Position FEN (avant le coup): ${record.fenBefore}\n`;
    prompt += `${playerStr} ont joué: ${record.san}\n`;
    prompt += `Évaluation de ce coup: ${classificationFr}.\n`;

    if (record.cpAfter !== undefined) {
      const evalStr = record.mateAfter !== undefined 
        ? `Mat en ${record.mateAfter}` 
        : (record.cpAfter / 100).toFixed(1);
      prompt += `L'évaluation après ce coup est de ${evalStr}.\n`;
    }

    if (record.bestMove && record.classification !== 'best' && record.classification !== 'book') {
      prompt += `Le moteur indique que le meilleur coup était: ${record.bestMove}\n`;
    }

    prompt += `\nConsigne: Rédige UNE phrase courte en français pour commenter ce coup et expliquer pourquoi c'est ${classificationFr}.`;

    return await GroqAPI.fetchChatCompletion(prompt, this.SYSTEM_PROMPT);
  }
}
