/**
 * Ordered model reference chain mirrored by the server gateway (`/api/coach`:
 * Groq -> OpenRouter -> TokenHarbor).
 */
export const COACH_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'openrouter/free',
  'deepseek-v4.1-flash:free',
] as const;

export type CoachModel = (typeof COACH_MODELS)[number];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /** Abort the request after this delay (ms). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
/**
 * Reasoning models spend tokens thinking before answering: a 40-token cap
 * returns an empty `content` (~300 reasoning tokens is the observed floor).
 * 1200 leaves room for the thinking *and* the coach's Markdown answer.
 */
const DEFAULT_MAX_TOKENS = 900;

/**
 * Client for the `/api/coach` multi-provider AI gateway (Groq -> OpenRouter -> TokenHarbor).
 * Exported as both `RiverAPI` (legacy alias) and `CoachAPI`.
 *
 * The browser never sees API keys: `/api/coach` routes requests server-side.
 */
export class RiverAPI {
  public static async fetchChatCompletion(
    messages: ChatMessage[],
    systemPrompt?: string,
    options: ChatCompletionOptions = {}
  ): Promise<string> {
    try {
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages,
          temperature: options.temperature ?? 0.7,
          maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS + 5_000),
      });

      if (!response.ok) {
        console.error('[CoachAPI] HTTP error:', response.status, response.statusText);
        return 'Le coach est momentanément indisponible.';
      }

      const data = (await response.json()) as {
        content?: string;
        model?: string;
        error?: string;
      };

      if (data.error) {
        console.error('[CoachAPI] Gateway error:', data.error);
        return 'Le coach est momentanément indisponible.';
      }

      const content = (data.content ?? '').trim();
      return content.length > 0 ? content : 'Analyse non disponible.';
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        console.error('[CoachAPI] The coach timed out.');
      } else {
        console.error('[CoachAPI] Network error:', error);
      }
      return 'Impossible de contacter le coach.';
    }
  }

  /** Convenience wrapper kept for callers that only have one prompt. */
  public static async complete(
    prompt: string,
    systemPrompt: string = "Tu es un coach d'échecs expert et concis.",
    options: ChatCompletionOptions = {}
  ): Promise<string> {
    return this.fetchChatCompletion([{ role: 'user', content: prompt }], systemPrompt, options);
  }
}

export const CoachAPI = RiverAPI;
