import { NextResponse } from 'next/server';
import { MAX_COACH_BODY_BYTES } from '../_validation';
import { enforceRateLimit, rateLimitedResponse } from '../_ratelimit';
import { AIGateway } from './gateway/AIGateway';

const DEFAULT_MAX_TOKENS = 1200;
const MIN_MAX_TOKENS = 500;
const GLOBAL_TIMEOUT_MS = 15_000;
const MAX_MESSAGES = 12;

// Instance unique de l'Orchestrateur IA (partage l'état du Circuit Breaker & rotation)
const aiGateway = new AIGateway({
  maxNetworkAttempts: 3,
  defaultGlobalTimeoutMs: GLOBAL_TIMEOUT_MS,
});

interface CoachRequest {
  messages?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
}

function isValidMessages(value: unknown): value is Array<{ role: string; content: string }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return false;
  return value.every(
    m =>
      typeof m === 'object' &&
      m !== null &&
      typeof (m as { role?: unknown }).role === 'string' &&
      typeof (m as { content?: unknown }).content === 'string' &&
      ['user', 'assistant', 'system'].includes((m as { role: string }).role)
  );
}

export async function POST(request: Request) {
  // C1 : Contrôle d'origine anti-abus (Origin / Host)
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return NextResponse.json({ error: 'Origin rejected' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid origin header' }, { status: 403 });
    }
  }

  // 1. Rate limit par IP (Sliding Window) AVANT lecture du corps
  const rate = enforceRateLimit(request, 'coach', 40);
  if (!rate.ok) return rateLimitedResponse(rate);

  // 2. Borne la taille du corps AVANT lecture
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COACH_BODY_BYTES) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }

  let body: CoachRequest;
  try {
    const raw = await request.text();
    if (raw.length > MAX_COACH_BODY_BYTES) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    body = JSON.parse(raw) as CoachRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const messages = body.messages;
  if (!isValidMessages(messages)) {
    return NextResponse.json({ error: 'messages must be a non-empty array' }, { status: 400 });
  }

  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;
  const requested = typeof body.maxTokens === 'number' ? body.maxTokens : DEFAULT_MAX_TOKENS;
  const maxTokens = Math.max(MIN_MAX_TOKENS, requested);

  // 3. Délégation à l'orchestrateur avec passage du signal client pour annulation
  const result = await aiGateway.complete({
    messages,
    temperature,
    maxTokens,
    clientSignal: request.signal,
    globalTimeoutMs: GLOBAL_TIMEOUT_MS,
  });

  if (result.ok) {
    return NextResponse.json({
      content: result.content,
      model: result.modelUsed,
    });
  }

  // 4. Si tous les fournisseurs ont échoué ou si le budget est épuisé :
  // Renvoi 502 propre pour déclencher le repli déterministe côté client
  return NextResponse.json(
    {
      error: result.error,
      attempts: result.failures,
      hint: 'The local deterministic coach fallback will handle explanations.',
    },
    { status: 502 }
  );
}
