import { NextRequest, NextResponse } from 'next/server';

let currentKeyIndex = 0;

export async function POST(req: NextRequest) {
  try {
    const keysString = process.env.GROQ_API_KEYS;
    if (!keysString) {
      return NextResponse.json(
        { error: 'GROQ_API_KEYS is missing' },
        { status: 500 }
      );
    }
    const apiKeys = keysString.split(',').map(k => k.trim()).filter(Boolean);

    const body = await req.json();
    const { fen, move, san, classification, evaluation, pv, languageLevel = 'intermediate', theory, color, moveNumber, bestMove, expectedReply } = body;

    const systemPrompt = `Tu es un coach d'échecs francophone.
Stockfish et les règles applicatives sont les seules sources de vérité.
Ne dis jamais qu'un coup appartient aux Blancs ou aux Noirs sans vérifier le champ color. Ne cite jamais une pièce incompatible avec la case de départ.
Tu ne dois ni recalculer la position, ni proposer de coup absent des données, ni inventer une menace, un gain matériel ou une variante.

Ton rôle est d'analyser le dernier coup joué et de fournir une explication pédagogique compréhensible par un joueur de niveau ${languageLevel}.
Explique la décision fournie en couvrant si possible ces points :
1. Diagnostic global de la position.
2. Qualité du coup joué.
3. Pourquoi le meilleur coup alternatif est préférable (s'il s'agit d'une erreur).
4. Leçon pratique à retenir.

Si une information n'existe pas dans les données, n'invente rien.

Tu dois formuler ton retour STRICTEMENT au format JSON, sans texte avant ou après ni balises Markdown.
Structure attendue :
{
  "explanation": "Ton explication structurée et claire",
  "themes": ["Contrôle du centre", "Développement", "Attaque double", "Roi au centre", ...],
  "sentiment": "positive" // ou "neutral", "negative", "warning" selon la qualité du coup
}`;

    const classificationMap: Record<string, string> = {
      'book': 'Coup théorique d\'ouverture (Excellent)',
      'best': 'Meilleur coup absolu',
      'great': 'Très bon coup',
      'excellent': 'Excellent coup',
      'good': 'Bon coup',
      'inaccuracy': 'Imprécision légère',
      'mistake': 'Erreur',
      'blunder': 'Gaffe (Très mauvais coup)'
    };
    const translatedClassification = classificationMap[classification] || classification;

    const dataContext = {
      position: {
        fen_before_move: fen,
        side_to_move_after: color === 'white' ? 'black' : 'white'
      },
      played_move: {
        uci: move,
        san: san,
        color: color || 'unknown',
        move_number: moveNumber || 'unknown'
      },
      engine_analysis: {
        classification: translatedClassification,
        evaluation: evaluation?.value !== undefined ? (evaluation.type === 'mate' ? 'Mat en ' + evaluation.value : 'Avantage ' + (evaluation.value / 100).toFixed(2)) : 'Inconnue',
        best_alternative_move_uci: bestMove || null,
        expected_opponent_reply_uci: expectedReply || null,
        engine_pv: pv || []
      },
      opening_theory: theory ? {
        label: theory.label,
        popularity_percent: parseFloat(theory.popularity_percent.toFixed(1)),
        games_for_move: theory.games_for_move,
        games_in_position: theory.games_in_position
      } : null
    };

    const userPrompt = JSON.stringify(dataContext, null, 2);

    // Fonction utilitaire pour interroger Groq avec rotation de clé
    const fetchGroq = async (model: string, messages: any[], expectJson: boolean = false) => {
      // Round-robin pour sélectionner une clé
      const apiKey = apiKeys[currentKeyIndex];
      currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.6,
          ...(expectJson ? { response_format: { type: "json_object" } } : {})
        })
      });

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status}`);
      }
      const json = await response.json();
      return json.choices[0]?.message?.content || "";
    };

    // Appel unique au modèle avec le prompt strict
    const text = await fetchGroq('llama-3.3-70b-versatile', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], true);
    
    // Extract JSON in case the model adds markdown formatting
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Groq parse error] Raw text:', text);
      throw new Error("Invalid response format from Groq");
    }

    const data = JSON.parse(jsonMatch[0]);

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[Analyze API Error]', error);
    return NextResponse.json(
      { error: 'Failed to generate explanation', details: error.message || String(error) },
      { status: 500 }
    );
  }
}
