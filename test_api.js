async function testAPI() {
  try {
    const res = await fetch('http://localhost:3000/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1',
        move: 'd2d4',
        san: 'd4',
        classification: 'book',
        evaluation: { type: 'cp', value: 30 },
        pv: ['e4', 'e5'],
        languageLevel: 'intermediate'
      })
    });
    
    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Response:", text);
  } catch (e) {
    console.error("Fetch failed:", e.message);
  }
}
testAPI();
