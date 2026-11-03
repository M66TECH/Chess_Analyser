import { NextResponse } from 'next/server';
import { COACH_MODELS } from '@chess-analyzer/chess-core';

const RIVER_URL = 'https://api.river.ai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Some models in the chain (GLM-5.3, DeepSeek-V4.1) are reasoning models: they
 * spend the budget on `reasoning_content` before writing `content`. A 40-token
 * cap yields an empty answer, and ~300 reasoning tokens is the observed floor,
 * so the default leaves room for both the thinking and the Markdown answer.
 */
const DEFAULT_MAX_TOKENS = 1200;
/** Never run below this: the message would be cut with empty content. */
const MIN_MAX_TOKENS = 500;

// Server-only secret. NEXT_PUBLIC_* must never be used here: those values are
// inlined into the client bundle and would leak to every visitor.
function getApiKey(): string | null {
  return process.env.RIVER_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim() || null;
}

/**
 * Models can be overridden per deployment, e.g.
 * RIVER_MODELS="zai-org/GLM-5.3-Flash,deepseek-ai/DeepSeek-V4.1-Flash-1017"
 */
function getModels(): string[] {
  const configured = process.env.RIVER_MODELS?.split(',').map(m => m.trim()).filter(Boolean);
  return configured && configured.length > 0 ? configured : [...COACH_MODELS];
}

interface CoachRequest {
  messages?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
}

function isValidMessages(value: unknown): value is Array<{ role: string; content: string }> {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    m =>
      typeof m === 'object' &&
      m !== null &&
      typeof (m as { role?: unknown }).role === 'string' &&
      typeof (m as { content?: unknown }).content === 'string'
  );
}

export async function POST(request: Request) {
  let body: CoachRequest;
  try {
    body = (await request.json()) as CoachRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const messages = body.messages;
  if (!isValidMessages(messages)) {
    return NextResponse.json({ error: 'messages must be a non-empty array' }, { status: 400 });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing RIVER_API_KEY on the server' }, { status: 401 });
  }

  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;
  const requested = typeof body.maxTokens === 'number' ? body.maxTokens : DEFAULT_MAX_TOKENS;
  const maxTokens = Math.max(MIN_MAX_TOKENS, requested);
  const models = getModels();

  const failures: string[] = [];

  // Walk the preference chain: the first model that answers wins.
  for (const model of models) {
    try {
      const res = await fetch(RIVER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        // Do not log response bodies: they may echo request data.
        console.error(`[coach] ${model} -> ${res.status} ${res.statusText}`);
        failures.push(`${model}: HTTP ${res.status}`);
        continue;
      }

      const data = (await res.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
      };

      const choice = data.choices?.[0];
      const content = choice?.message?.content?.trim() ?? '';

      if (content.length === 0) {
        // Reasoning models can consume the whole budget thinking. It is a
        // retryable condition, not a definitive failure: tell the client with a
        // stable signal so another attempt can be made.
        const reasoning = choice?.message?.reasoning_content?.length ?? 0;
        console.error(
          `[coach] ${model} returned empty content (finish_reason=${choice?.finish_reason ?? 'n/a'}, reasoning_chars=${reasoning})`
        );
        failures.push(`${model}: empty answer`);
        continue;
      }

      return NextResponse.json({ content, model: data.model ?? model });
    } catch (error: unknown) {
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      const reason = isTimeout ? 'timeout' : error instanceof Error ? error.message : 'unknown error';
      console.error(`[coach] ${model} failed: ${reason}`);
      failures.push(`${model}: ${reason}`);
    }
  }

  // Every model failed: report a stable status with the chain for debugging.
  return NextResponse.json(
    {
      error: 'All coach models are unavailable',
      attempts: failures,
      hint: 'Reasoning models need a larger maxTokens; try again or raise it in the request.',
    },
    { status: 502 }
  );
}
