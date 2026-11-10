/**
 * Limitation de débit en mémoire (sliding window par IP).
 *
 * Les routes proxy de Chess Analyzer relaient des API distantes payantes ou
 * quotas (jeton Lichess, LLM River). Sans plafond par IP, un tiers peut vider
 * nos quotas. Le compteur vit en mémoire : suffisant pour une instance
 * monoprocess (Next self-hosted). En multi-instances, remplacer par un
 * magasin partagé — l'interface reste identique.
 *
 * Choix : sliding window (fenêtre glissante) plutôt que fixed window — évite
 * les rafales en début de fenêtre, coût mémoire borné par MAX_KEYS.
 */

const WINDOW_MS = 60 * 1000;
const MAX_KEYS = 10_000; // entrées IP max ; purge au-delà

interface WindowState {
  timestamps: number[];
}

const store = new Map<string, WindowState>();

function clientKey(request: Request): string {
  // x-forwarded-for est fourni par les proxys ; absent en local/dev.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() ?? 'local';
}

function prune(): void {
  if (store.size <= MAX_KEYS) return;
  const now = Date.now();
  for (const [key, state] of store) {
    if (state.timestamps.length === 0 || now - state.timestamps.at(-1)! > WINDOW_MS) {
      store.delete(key);
    }
    if (store.size <= MAX_KEYS) return;
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  limit: number;
  retryAfterSec: number;
}

/**
 * À appeler au début de chaque route proxy :
 *   const rate = enforceRateLimit(request, 'coach', 40);
 *   if (!rate.ok) return rateLimitedResponse(request, rate);
 */
export function enforceRateLimit(request: Request, bucket: string, limitPerMinute: number): RateLimitResult {
  const key = `${bucket}:${clientKey(request)}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  let state = store.get(key);
  if (!state) {
    state = { timestamps: [] };
    store.set(key, state);
  }
  prune();

  // Retire les entrées hors fenêtre.
  while (state.timestamps.length > 0 && state.timestamps[0] < windowStart) {
    state.timestamps.shift();
  }

  if (state.timestamps.length >= limitPerMinute) {
    const oldest = state.timestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    return { ok: false, remaining: 0, limit: limitPerMinute, retryAfterSec };
  }

  state.timestamps.push(now);
  return { ok: true, remaining: limitPerMinute - state.timestamps.length, limit: limitPerMinute, retryAfterSec: 0 };
}

/** Purge complète (tests). */
export function resetRateLimiter(): void {
  store.clear();
}

/**
 * Réponse prête à retourner pour un `RateLimitResult` refusé : inclut les
 * headers standard de rate limiting.
 */
export function rateLimitedResponse(rate: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: 'Requêtes trop fréquentes. Réessayez dans quelques secondes.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(rate.retryAfterSec),
        'X-RateLimit-Limit': String(rate.limit),
        'X-RateLimit-Remaining': '0',
      },
    }
  );
}
