import * as fs from 'fs';
import * as path from 'path';

// Charge .env.local
const envPath = path.join(process.cwd(), 'apps', 'web', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const SYSTEM_PROMPT = `# Rôle
Tu es ChessCoach, entraîneur d'échecs pour DÉBUTANTS. Tu lis une analyse déjà calculée (Stockfish + Lichess + faits géométriques vérifiés). Tu ne recalcules rien.

# Règle absolue : court et simple
- Le joueur débute. Il ne connaît pas la notation.
- INTERDIT d'écrire une notation seule : ni « Nf3 », ni « Bxc6 », ni « a4 », ni « e2e4 ».
- Nomme TOUJOURS la pièce en français (pion, cavalier, fou, tour, dame, roi) et indique sa case d'arrivée en clair : « le cavalier va en f3 ».
- Aucun jargon : ni « centipawn », ni « tempo », ni « structure », ni « zone », ni « initiative ».
- Pas de paragraphe. Une idée = une phrase de 15 mots maximum.

# Longueur imposée
- headline : 10 mots maximum. C'est le conseil principal.
- insights : 1 ou 2 maximum (jamais 3 ni 5). Chaque text ≤ 20 mots.
- takeaway : une seule phrase courte, actionnable.

# Structure conseillée
1. Le PROBLÈME, en une phrase (« votre dame peut être prise »).
2. L'ACTION recommandée, en une phrase (« mettez-la en sécurité en d1 »).

# Langue
Réponds EXCLUSIVEMENT en français : aucun mot anglais dans les textes.
Adresse-toi au joueur en VOUVOYANT (« vous », « votre ») : jamais « tu » ni « ton ».

# Format
Réponds UNIQUEMENT par un objet JSON valide :
{"headline":"...","insights":[{"kind":"played_move","text":"..."}],"takeaway":"..."}
kinds autorisés : played_move, missed_move, mistake, good_decision, consequence.`;

interface BenchmarkPosition {
  id: string;
  category: string;
  name: string;
  expectedKeyword: string;
  prompt: string;
}

const BENCHMARK_POSITIONS: BenchmarkPosition[] = [
  {
    id: 'pos_1_tactical_blunder',
    category: 'Tactique & Gaffe',
    name: 'Gaffe avec pièce en prise (Cavalier en e4)',
    expectedKeyword: 'cavalier',
    prompt: JSON.stringify({
      fen: 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5',
      played_move: { san: 'Nxe4', uci: 'c6e4', color: 'b', piece: 'cavalier' },
      classification: 'blunder',
      win_drop: 0.42,
      tactical_facts: {
        hanging_pieces: ['le cavalier en e4'],
        opponent_threat: 'le fou blanc en c4 menace le roi noir en f7',
      },
      best_move: { san: 'Nf6', description: 'le cavalier va en f6' },
    }),
  },
  {
    id: 'pos_2_queen_safety',
    category: 'Sécurité de la Dame',
    name: 'Erreur positionnelle de Dame',
    expectedKeyword: 'dame',
    prompt: JSON.stringify({
      fen: 'r1bqk2r/ppp2ppp/2n5/3pP3/1b1P4/5N2/PP1B1PPP/R2QKB1R b KQkq - 0 9',
      played_move: { san: 'Qe7', uci: 'd8e7', color: 'b', piece: 'dame' },
      classification: 'mistake',
      win_drop: 0.28,
      tactical_facts: {
        hanging_pieces: [],
        opponent_threat: 'le fou blanc en b4 menace la structure',
      },
      best_move: { san: 'O-O', description: 'le petit roque' },
    }),
  },
  {
    id: 'pos_3_isolated_pawn',
    category: 'Stratégie',
    name: 'Pion d4 isolé & contrôle du centre',
    expectedKeyword: 'pion',
    prompt: JSON.stringify({
      fen: 'r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2N2N2/PP2BPPP/R1BQ1RK1 w - - 0 10',
      played_move: { san: 'Be3', uci: 'c1e3', color: 'w', piece: 'fou' },
      classification: 'good',
      win_drop: 0.02,
      tactical_facts: {
        hanging_pieces: [],
        pawn_structure: 'pion blanc isole en d4 qui controle le centre',
      },
      best_move: { san: 'Be3', description: 'le fou va en e3' },
    }),
  },
  {
    id: 'pos_4_greek_gift',
    category: 'Sacrifice & Attaque',
    name: 'Sacrifice thématique de fou en h7',
    expectedKeyword: 'fou',
    prompt: JSON.stringify({
      fen: 'r1bq1rk1/ppp1nppp/4p3/3pP3/3P4/2PB1N2/P1P2PPP/R2QK2R w KQ - 0 10',
      played_move: { san: 'Bxh7+', uci: 'd3h7', color: 'w', piece: 'fou' },
      classification: 'brilliant',
      win_drop: -0.55,
      tactical_facts: {
        sacrifice: 'sacrifice de fou en h7',
        opponent_threat: 'attaque decisive sur le roi adverse denude',
      },
      best_move: { san: 'Bxh7+', description: 'le fou prend en h7 avec echec' },
    }),
  },
  {
    id: 'pos_5_endgame_opposition',
    category: 'Finale de Pions',
    name: 'Prise de l’opposition en finale',
    expectedKeyword: 'roi',
    prompt: JSON.stringify({
      fen: '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1',
      played_move: { san: 'Kd3', uci: 'e3d3', color: 'w', piece: 'roi' },
      classification: 'best',
      win_drop: 0.0,
      tactical_facts: {
        endgame: "prise de l'opposition pour faire avancer le pion passe vers la promotion",
      },
      best_move: { san: 'Kd3', description: 'le roi va en d3' },
    }),
  },
];

interface ModelTarget {
  provider: string;
  modelId: string;
  baseUrl: string;
  key: string;
  headers?: Record<string, string>;
}

interface BenchmarkResult {
  provider: string;
  modelId: string;
  successRate: number;
  avgLatencyMs: number;
  jsonFormatScore: number; // 0-20
  frenchQualityScore: number; // 0-25
  chessRelevanceScore: number; // 0-35
  speedScore: number; // 0-20
  totalScore: number; // 0-100
  sampleHeadline: string;
  sampleTakeaway: string;
  errorsCount: number;
}

function getModelTargets(): ModelTarget[] {
  const targets: ModelTarget[] = [];

  // Groq
  const groqKey = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '').split(',')[0]?.trim();
  if (groqKey) {
    targets.push({
      provider: 'Groq',
      modelId: 'qwen/qwen3.8-27b',
      baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
      key: groqKey,
    });
    targets.push({
      provider: 'Groq',
      modelId: 'openai/gpt-oss-120b',
      baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
      key: groqKey,
    });
  }

  // TokenHarbor
  const thKey = (process.env.TOKENHARBOR_API_KEYS || process.env.TOKENHARBOR_API_KEY || '').split(',')[0]?.trim();
  if (thKey) {
    targets.push({
      provider: 'TokenHarbor',
      modelId: 'deepseek-v4.1-flash:free',
      baseUrl: 'https://tokenharbor.ai/v1/chat/completions',
      key: thKey,
    });
    targets.push({
      provider: 'TokenHarbor',
      modelId: 'deepseek-v4-flash:free',
      baseUrl: 'https://tokenharbor.ai/v1/chat/completions',
      key: thKey,
    });
  }

  // OpenRouter
  const orKey = process.env.OPENROUTER_API_KEY?.trim();
  if (orKey) {
    targets.push({
      provider: 'OpenRouter',
      modelId: 'openrouter/free',
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      key: orKey,
      headers: {
        'HTTP-Referer': 'https://chess-analyzer.local',
        'X-Title': 'Chess Analyzer Benchmark',
      },
    });
    targets.push({
      provider: 'OpenRouter',
      modelId: 'cohere/north-mini-code:free',
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      key: orKey,
      headers: {
        'HTTP-Referer': 'https://chess-analyzer.local',
        'X-Title': 'Chess Analyzer Benchmark',
      },
    });
  }

  return targets;
}

async function callModel(target: ModelTarget, userPrompt: string): Promise<{ latencyMs: number; text: string }> {
  const start = Date.now();
  const res = await fetch(target.baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${target.key}`,
      'Content-Type': 'application/json',
      ...(target.headers || {}),
    },
    body: JSON.stringify({
      model: target.modelId,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 600,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 100)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  };

  const choice = data.choices?.[0];
  const text = choice?.message?.content?.trim() || choice?.message?.reasoning_content?.trim() || '';
  return { latencyMs, text };
}

function parseCardJson(raw: string): { headline?: string; insights?: Array<{ text?: string }>; takeaway?: string } | null {
  try {
    let clean = raw.trim();
    if (clean.startsWith('```json')) clean = clean.slice(7);
    if (clean.startsWith('```')) clean = clean.slice(3);
    if (clean.endsWith('```')) clean = clean.slice(0, -3);
    return JSON.parse(clean.trim());
  } catch {
    return null;
  }
}

async function runBenchmark() {
  console.log('='.repeat(80));
  console.log('🚀 LANCEMENT DU BENCHMARK INTELLIGENCE & QUALITÉ ÉCHIQUÉENNE');
  console.log('='.repeat(80));

  const targets = getModelTargets();
  console.log(`Fournisseurs & Modèles détectés : ${targets.length}`);
  for (const t of targets) {
    console.log(` - ${t.provider} : ${t.modelId}`);
  }

  const summaryResults: BenchmarkResult[] = [];

  for (const target of targets) {
    console.log(`\n▶ Test en cours : [${target.provider}] ${target.modelId}...`);
    let successes = 0;
    let errors = 0;
    let totalLatency = 0;
    let jsonScoreTotal = 0;
    let frenchScoreTotal = 0;
    let chessScoreTotal = 0;
    let lastHeadline = '';
    let lastTakeaway = '';

    for (const pos of BENCHMARK_POSITIONS) {
      try {
        const { latencyMs, text } = await callModel(target, pos.prompt);
        totalLatency += latencyMs;
        successes += 1;

        // 1. Format JSON (max 20 pts par position)
        const parsed = parseCardJson(text);
        let posJsonScore = 0;
        if (parsed && typeof parsed.headline === 'string' && typeof parsed.takeaway === 'string') {
          posJsonScore = 20;
          lastHeadline = parsed.headline;
          lastTakeaway = parsed.takeaway;
        } else if (text.length > 20) {
          posJsonScore = 8; // Réponse reçue mais pas pur JSON
        }
        jsonScoreTotal += posJsonScore;

        // 2. Qualité du français & pas de jargon (max 25 pts)
        let posFrenchScore = 25;
        const lower = text.toLowerCase();
        // Vérifie absence de termes anglais d'échecs proscrits
        if (lower.includes('knight') || lower.includes('bishop') || lower.includes('rook') || lower.includes('queen') || lower.includes('pawn')) {
          posFrenchScore -= 10;
        }
        // Vérifie absence de tutoiement (« tu » / « ton » proscrit)
        if (/\b(tu|ton|ta|tes)\b/i.test(text)) {
          posFrenchScore -= 8;
        }
        // Vérifie absence de jargon (« centipawn »)
        if (lower.includes('centipawn') || lower.includes('eval')) {
          posFrenchScore -= 7;
        }
        frenchScoreTotal += Math.max(0, posFrenchScore);

        // 3. Pertinence échiquéenne (max 35 pts)
        let posChessScore = 35;
        if (!lower.includes(pos.expectedKeyword)) {
          posChessScore -= 10; // N'a pas identifié la pièce clé
        }
        if (text.length < 30) {
          posChessScore -= 15; // Trop laconique
        }
        chessScoreTotal += Math.max(0, posChessScore);

        console.log(`   ✓ ${pos.name} (${latencyMs}ms) : headline="${parsed?.headline ?? text.slice(0, 40)}"`);
      } catch (err: unknown) {
        errors += 1;
        const msg = err instanceof Error ? err.message : 'failed';
        console.log(`   ✗ ${pos.name} : ${msg}`);
      }
    }

    const totalPos = BENCHMARK_POSITIONS.length;
    const avgLatencyMs = successes > 0 ? Math.round(totalLatency / successes) : 9999;
    const jsonAvg = Math.round(jsonScoreTotal / totalPos);
    const frenchAvg = Math.round(frenchScoreTotal / totalPos);
    const chessAvg = Math.round(chessScoreTotal / totalPos);

    // Score de rapidité sur 20 pts
    let speedScore = 0;
    if (avgLatencyMs < 600) speedScore = 20;
    else if (avgLatencyMs < 1200) speedScore = 16;
    else if (avgLatencyMs < 2500) speedScore = 12;
    else if (avgLatencyMs < 5000) speedScore = 6;

    const totalScore = Math.round((successes / totalPos) * (jsonAvg + frenchAvg + chessAvg + speedScore));

    summaryResults.push({
      provider: target.provider,
      modelId: target.modelId,
      successRate: Math.round((successes / totalPos) * 100),
      avgLatencyMs,
      jsonFormatScore: jsonAvg,
      frenchQualityScore: frenchAvg,
      chessRelevanceScore: chessAvg,
      speedScore,
      totalScore,
      sampleHeadline: lastHeadline || '(aucun)',
      sampleTakeaway: lastTakeaway || '(aucun)',
      errorsCount: errors,
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 RÉSULTATS DU BENCHMARK INTELLIGENCE ÉCHIQUÉENNE');
  console.log('='.repeat(80));
  console.table(
    summaryResults.map(r => ({
      Fournisseur: r.provider,
      Modèle: r.modelId,
      'Succès %': `${r.successRate}%`,
      'Latence moy.': `${r.avgLatencyMs} ms`,
      'JSON (/20)': r.jsonFormatScore,
      'Français (/25)': r.frenchQualityScore,
      'Échecs (/35)': r.chessRelevanceScore,
      'Vitesse (/20)': r.speedScore,
      'NOTE GLOBALE (/100)': r.totalScore,
    }))
  );

  // Sauvegarde des résultats en JSON
  fs.writeFileSync(
    path.join(process.cwd(), 'benchmark-results.json'),
    JSON.stringify(summaryResults, null, 2),
    'utf8'
  );
  console.log('Rapport enregistré dans benchmark-results.json');
}

runBenchmark().catch(console.error);
