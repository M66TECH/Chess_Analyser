import { NextResponse } from 'next/server';
import { validateFen, validateMoveCount } from '../_validation';

// Server-only secret: never use NEXT_PUBLIC_* here, it would ship the token to
// every visitor.
const LICHESS_EXPLORER_URL =
  process.env.LICHESS_EXPLORER_URL?.trim() || 'https://explorer.lichess.ovh/masters';

/**
 * The Opening Explorer requires a Personal API Token on EVERY request:
 *   Authorization: Bearer <token>
 * A 401 usually means: no token sent, invalid/expired token, wrong header,
 * stray spaces/quotes — or the request went to lichess.org instead of
 * explorer.lichess.ovh.
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fenCheck = validateFen(searchParams.get('fen'));
  if (!fenCheck.ok) {
    return NextResponse.json({ error: fenCheck.error }, { status: 400 });
  }
  const fen = fenCheck.fen!;
  const moves = String(validateMoveCount(searchParams.get('moves')));

  const token = process.env.LICHESS_TOKEN?.trim() || null;
  if (!token) {
    return NextResponse.json(
      { error: 'LICHESS_TOKEN missing on the server: the Opening Explorer rejects unauthenticated calls (401).' },
      { status: 401 }
    );
  }

  const target = new URL(LICHESS_EXPLORER_URL);
  target.searchParams.set('fen', fen);
  target.searchParams.set('moves', moves);
  target.searchParams.set('topGames', '0');
  // The all-games database (/lichess) selects the variant; masters ignores it.
  if (target.pathname.endsWith('/lichess')) {
    target.searchParams.set('variant', 'standard');
  }

  try {
    const res = await fetch(target, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ChessAnalyzer/1.0',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      if (res.status === 401) {
        console.error('Lichess Explorer 401: token invalide/expiré ou en-tête mal formé');
        return NextResponse.json(
          { error: 'Lichess Explorer rejected the token (401). Check LICHESS_TOKEN.' },
          { status: 401 }
        );
      }
      console.error(`Lichess Explorer error: ${res.status} ${res.statusText}`);
      return NextResponse.json(
        { error: `Lichess Explorer returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error('Explorer proxy error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
