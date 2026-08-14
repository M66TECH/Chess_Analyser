export class GroqAPI {
  private static keys: string[] = [];
  private static currentIndex = 0;

  private static getKeys(): string[] {
    if (this.keys.length > 0) return this.keys;
    const envKeys = process.env.NEXT_PUBLIC_GROQ_KEYS;
    if (envKeys) {
      this.keys = envKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);
    }
    return this.keys;
  }

  private static getNextKey(): string | null {
    const keys = this.getKeys();
    if (keys.length === 0) return null;
    const key = keys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % keys.length;
    return key;
  }

  public static async fetchChatCompletion(prompt: string, systemPrompt: string = 'Tu es un coach d\'échecs expert et concis.'): Promise<string> {
    const apiKey = this.getNextKey();
    if (!apiKey) return 'Clé API non configurée.';
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 150
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
