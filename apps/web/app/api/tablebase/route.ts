import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fen = searchParams.get('fen');

  if (!fen) {
    return NextResponse.json({ error: 'FEN is required' }, { status: 400 });
  }

  const lichessUrl = `https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`;

  try {
    const res = await fetch(lichessUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ChessAnalyzer/1.0'
      },
      cache: 'no-store'
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
