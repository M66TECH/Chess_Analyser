import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fen = searchParams.get('fen');
  const moves = searchParams.get('moves') || '12';
  const topGames = searchParams.get('topGames') || '0';

  if (!fen) {
    return NextResponse.json({ error: 'FEN is required' }, { status: 400 });
  }

  const lichessUrl = `https://explorer.lichess.org/masters?fen=${encodeURIComponent(fen)}&moves=${moves}&topGames=${topGames}`;
  const token = process.env.LICHESS_TOKEN || process.env.NEXT_PUBLIC_LICHESS_TOKEN;

  try {
    const res = await fetch(lichessUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ChessAnalyzer/1.0',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      cache: 'no-store'
    });

    if (!res.ok) {
      console.error(`Lichess API Error: ${res.status} ${res.statusText}`);
      return NextResponse.json({ error: `Lichess API returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Proxy Fetch Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error', stack: error.stack }, { status: 500 });
  }
}
