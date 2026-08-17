import { NextResponse } from 'next/server';

let currentIndex = 0;

function getNextGroqKey(): string | null {
  const envKeys =
    process.env.GROQ_KEYS ||
    process.env.GROQ_API_KEYS ||
    process.env.NEXT_PUBLIC_GROQ_KEYS;
  if (!envKeys) return null;
  const keys = envKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);
  if (keys.length === 0) return null;
  
  const key = keys[currentIndex];
  currentIndex = (currentIndex + 1) % keys.length;
  return key;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const apiKey = getNextGroqKey();

    if (!apiKey) {
      return NextResponse.json({ error: 'Missing API Key in server env' }, { status: 401 });
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`Groq API Error: ${res.status} ${errorText}`);
      return NextResponse.json({ error: `Groq API returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error('Groq Proxy Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
