import { NextResponse } from 'next/server';
import { validateFen } from '../_validation';
import { enforceRateLimit, rateLimitedResponse } from '../_ratelimit';

export async function GET(request: Request) {
  // Rate limit : route proxy vers un service externe.
  const rate = enforceRateLimit(request, 'tablebase', 60);
  if (!rate.ok) return rateLimitedResponse(rate);

  const { searchParams } = new URL(request.url);
  const fenCheck = validateFen(searchParams.get('fen'));
  if (!fenCheck.ok) {
    return NextResponse.json({ error: fenCheck.error }, { status: 400 });
  }
  const fen = fenCheck.fen!;

  const lichessUrl = `https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`;
  // The tablebase currently answers 200 without a token, but sending one is
  // harmless and keeps the call authenticated if that ever changes.
  const token = process.env.LICHESS_TOKEN?.trim();

  try {
    const res = await fetch(lichessUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ChessAnalyzer/1.0',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });

    if (!res.ok) {
      console.error(`Syzygy API Error: ${res.status} ${res.statusText}`);
      return NextResponse.json({ error: `Syzygy API returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Proxy Fetch Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
