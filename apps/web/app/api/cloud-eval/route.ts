import { NextResponse } from 'next/server';
import { validateFen, validateMultiPv } from '../_validation';

/**
 * Proxy vers le Cloud Eval de Lichess (l'équivalent REST du websocket
 * `evalGet` de lila, servi par `modules/evalCache`).
 *
 * - Pas d'authentification requise pour cette API publique.
 * - 404 = aucune évaluation cloud pour ce FEN (réponse légitime, pas une
 *   erreur : le client retirera son `awaiting` et garde le local).
 * - Cache CDN 10 min : côté lila les hits vivent des heures en Redis ; un
 *   FEN analysé en profondeur 25+ ne change pas en 10 minutes.
 */
const CLOUD_EVAL_URL = 'https://lichess.org/api/cloud-eval';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fenCheck = validateFen(searchParams.get('fen'));
  if (!fenCheck.ok) {
    return NextResponse.json({ error: fenCheck.error }, { status: 400 });
  }
  const fen = fenCheck.fen!;
  const multiPv = String(validateMultiPv(searchParams.get('multiPv')));

  const target = `${CLOUD_EVAL_URL}?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`;

  try {
    const res = await fetch(target, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ChessAnalyzer/1.0',
      },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8_000),
    });

    if (res.status === 404) {
      // Pas de hit cloud : forwardé tel quel, le client gère.
      return NextResponse.json({ error: 'No cloud eval' }, { status: 404 });
    }
    if (!res.ok) {
      console.error(`Lichess CloudEval error: ${res.status} ${res.statusText}`);
      return NextResponse.json({ error: `Lichess CloudEval returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error('CloudEval proxy error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
