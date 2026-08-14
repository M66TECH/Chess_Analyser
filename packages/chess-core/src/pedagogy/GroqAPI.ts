export class GroqAPI {
  public static async fetchChatCompletion(prompt: string, systemPrompt: string = 'Tu es un coach d\'échecs expert et concis.'): Promise<string> {
    const url = '/api/groq';
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 300
        })
      });

      if (!response.ok) {
        console.error('[GroqAPI] Erreur HTTP:', response.status, response.statusText);
        return 'Le coach est momentanément indisponible.';
      }

      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        return data.choices[0].message.content.trim();
      }

      return 'Analyse non disponible.';
    } catch (error) {
      console.error('[GroqAPI] Erreur réseau:', error);
      return 'Impossible de contacter le coach.';
    }
  }
}
