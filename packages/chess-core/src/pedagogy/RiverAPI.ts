/**
 * Ordered model chain for the coach. The first one is the preferred model; the
 * following ones are used only when the previous one fails (quota, outage,
 * unknown model...). Keep the order in sync with RIVER_MODELS in .env.example.
 */
export const COACH_MODELS = [
  'qwen/qwen3.8-27b',
  'deepseek-v4.1-flash:free',
  'openai/gpt-oss-120b',
  'openrouter/free',
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
const DEFAULT_MAX_TOKENS = 1200;

/**
 * Client for the River OpenAI-compatible gateway.
 *
 * The browser never sees the API key: it calls /api/coach, which forwards to
 * the gateway server-side and walks COACH_MODELS in order.
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
        console.error('[RiverAPI] HTTP error:', response.status, response.statusText);
        return 'Le coach est momentanément indisponible.';
      }

      const data = (await response.json()) as {
        content?: string;
        model?: string;
        error?: string;
      };

      if (data.error) {
        console.error('[RiverAPI] Gateway error:', data.error);
        return 'Le coach est momentanément indisponible.';
      }

      const content = (data.content ?? '').trim();
      return content.length > 0 ? content : 'Analyse non disponible.';
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        console.error('[RiverAPI] The coach timed out.');
      } else {
        console.error('[RiverAPI] Network error:', error);
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
