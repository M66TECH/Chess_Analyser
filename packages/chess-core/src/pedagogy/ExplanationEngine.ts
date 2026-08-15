import { MoveRecord } from './types';
import { GroqAPI } from './GroqAPI';

export class ExplanationEngine {
  private static readonly SYSTEM_PROMPT = `Tu es un grand maître international d'échecs et un coach réputé.
Ton rôle est de commenter le dernier coup joué par l'utilisateur en UNE SEULE PHRASE (10-20 mots maximum).
RÈGLES STRICTES CONTRE LES HALLUCINATIONS :
1. Tu ne vois pas l'échiquier. NE DEVINE JAMAIS les pièces capturées ou les cases des autres pièces.
2. Si le coup est une Gaffe (Blunder), ne dis pas "tu donnes ta dame pour un pion" à moins d'en être sûr à 100%. Dis plutôt "Tu perds du matériel critique", "Tu offres une pièce" ou "Ce coup détruit ta position".
3. Concentre-toi sur le concept stratégique (sécurité du roi, contrôle du centre, développement, perte de matériel) déduit de l'évaluation du moteur.
4. Parle à la deuxième personne ("Tu"). Sois percutant, comme un coach sévère mais juste.`;

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

    // Basic heuristic to help the AI
    const isCapture = record.san.includes('x');
    const isCheck = record.san.includes('+');
    let contextHint = '';
    if (record.classification === 'blunder') {
      contextHint = isCapture ? "Ce coup capture une pièce mais perd beaucoup de matériel en retour ou permet un mat." : "Ce coup laisse une pièce vulnérable, perd du matériel ou permet au roi d'être attaqué.";
    }

    let prompt = `Voici les faits bruts générés par l'ordinateur Stockfish :\n`;
    prompt += `- Le joueur a joué le coup : ${record.san} (Notation algébrique standard).\n`;
    if (isCapture) prompt += `- Ce coup est une capture (symbole 'x').\n`;
    if (isCheck) prompt += `- Ce coup met le roi adverse en échec (symbole '+').\n`;
    prompt += `- Stockfish a évalué ce coup comme : ${classificationFr}.\n`;

    if (record.cpAfter !== undefined) {
      const evalStr = record.mateAfter !== undefined 
        ? `Mat en ${Math.abs(record.mateAfter)}` 
        : (record.cpAfter / 100).toFixed(1);
      prompt += `- Évaluation de la position après ce coup : ${evalStr}.\n`;
    }

    if (record.bestMove && record.classification !== 'best' && record.classification !== 'book') {
      prompt += `- Stockfish recommandait de jouer plutôt : ${record.bestMove}.\n`;
    }

    if (contextHint) {
      prompt += `- Indice de contexte pour ta réponse : ${contextHint}\n`;
    }

    prompt += `\nRédige ta phrase d'explication maintenant :`;

    return await GroqAPI.fetchChatCompletion(prompt, this.SYSTEM_PROMPT);
  }
}
