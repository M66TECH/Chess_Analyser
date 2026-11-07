import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExplanationEngine, sanitizeCaption } from '../pedagogy/ExplanationEngine';
import { RiverAPI } from '../pedagogy/RiverAPI';
import type { MoveRecord } from '../pedagogy/types';

/**
 * Le prompt doit porter les consignes de brièveté, l'interdiction de rejouer
 * les coups, et un TON émotionnel propre à chaque cas.
 */
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function record(overrides: Partial<MoveRecord> = {}): MoveRecord {
  return {
    fenBefore: START,
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    playedMove: 'e2e4',
    bestMove: 'e2e4',
    bestPv: ['e2e4', 'e7e5'],
    cpBefore: 20,
    cpAfter: 20,
    winProbBefore: 0,
    winProbAfter: 0,
    accuracy: 100,
    classification: 'best',
    moveNumber: 1,
    color: 'white',
    san: 'e4',
    nodeId: 'n1',
    ...overrides,
  };
}

describe('Prompt du coach — consignes', () => {
  let prompt: string;

  beforeEach(() => {
    const spy = vi.spyOn(RiverAPI, 'complete').mockResolvedValue(
      '{"headline":"X","insights":[],"takeaway":"Y"}'
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    prompt = '';
    spy.mockImplementation(async (p: string) => {
      prompt = p;
      return '{"headline":"X","insights":[],"takeaway":"Y"}';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const capture = async (overrides: Partial<MoveRecord>) => {
    await ExplanationEngine.generateCard(record(overrides));
    return prompt;
  };

  it('interdit explicitement de rejouer les coups', async () => {
    const p = await capture({});
    expect(p).toMatch(/Ne rejoue PAS les coups toi-même/i);
  });

  it('impose des bornes de longueur chiffrées', async () => {
    const p = await capture({});
    expect(p).toMatch(/headline : \d+ mots maximum/i);
    expect(p).toMatch(/insights : \d+ maximum/i);
    expect(p).toMatch(/takeaway : une seule phrase/i);
  });

  it('célèbre un coup brillant', async () => {
    const p = await capture({ classification: 'brilliant' });
    expect(p).toMatch(/BRILLANT/i);
    expect(p).toMatch(/Félicite|Bravo/i);
  });

  it('rassure sur une gaffe, sans reproche', async () => {
    const p = await capture({ classification: 'blunder' });
    expect(p).toMatch(/pas de panique/i);
    expect(p).toMatch(/AUCUN reproche/i);
  });

  it('adoucit une imprécision', async () => {
    const p = await capture({ classification: 'inaccuracy' });
    expect(p).toMatch(/doucement|sans dramatiser/i);
  });

  it('change de ton quand un mat apparaît', async () => {
    const p = await capture({ classification: 'blunder', mateSequence: 'created' });
    expect(p).toMatch(/va se faire mater/i);
    expect(p).toMatch(/calme/i);
  });

  it('reste encourageant pour un coup théorique', async () => {
    const p = await capture({ classification: 'book' });
    expect(p).toMatch(/ouverture classique|théorie/i);
  });
});

describe('Prompt de démonstration', () => {
  it('contient la séquence, la position et le nombre exact de phrases', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const prompt = ExplanationEngine.buildDemoPrompt(fen, ['e2e4', 'e7e5', 'g1f3'], 'idea');

    expect(prompt).toContain('SÉQUENCE : e2e4 e7e5 g1f3');
    expect(prompt).toContain(`POSITION DE DÉPART : ${fen}`);
    expect(prompt).toContain('exactement 3 phrases');
    expect(prompt).toMatch(/Ne rejoue PAS les coups toi-même/i);
    expect(prompt).toMatch(/12 mots maximum/);
    expect(prompt).toMatch(/AUCUNE notation/i);
  });

  it('adapte le ton : punir une erreur vs montrer la bonne idée', () => {
    const punish = ExplanationEngine.buildDemoPrompt(START, ['e2e4'], 'punish');
    const idea = ExplanationEngine.buildDemoPrompt(START, ['e2e4'], 'idea');
    expect(punish).toMatch(/erreur/i);
    expect(punish).toMatch(/jamais moqueur/i);
    expect(idea).toMatch(/encourageant/i);
  });
});

describe('generateDemoCaptions', () => {
  const params = {
    startFen: START,
    uciMoves: ['e2e4', 'e7e5'],
    kind: 'idea' as const,
    fallbackCaptions: ['Le pion va en e4.', 'Le pion va en e5.'],
  };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('utilise les phrases du modèle quand elles sont propres', async () => {
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue(
      '["Le pion avance pour occuper le centre.", "Les Noirs répondent au centre."]'
    );
    const captions = await ExplanationEngine.generateDemoCaptions(params);
    expect(captions[0]).toContain('centre');
    expect(captions[1]).toContain('Noirs');
  });

  it('remplace une phrase contenant de la notation par le repli déterministe', async () => {
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue(
      '["Nf3 développe une pièce.", "Les Noirs jouent symétriquement."]'
    );
    const captions = await ExplanationEngine.generateDemoCaptions(params);
    // Notation détectée → phrase rejetée, repli conservé.
    expect(captions[0]).toBe('Le pion va en e4.');
    expect(captions[1]).toBe('Les Noirs jouent symétriquement.');
  });

  it('ne dépasse jamais le nombre de coups', async () => {
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue(
      '["a","b","c","d","e"]'
    );
    const captions = await ExplanationEngine.generateDemoCaptions(params);
    expect(captions).toHaveLength(2);
  });

  it('retombe sur le repli en cas d\'échec réseau', async () => {
    vi.spyOn(RiverAPI, 'complete').mockRejectedValue(new Error('offline'));
    const captions = await ExplanationEngine.generateDemoCaptions(params);
    expect(captions).toEqual(params.fallbackCaptions);
  });

  it('retombe sur le repli si la réponse n\'est pas un tableau JSON', async () => {
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue('je ne peux pas répondre');
    const captions = await ExplanationEngine.generateDemoCaptions(params);
    expect(captions).toEqual(params.fallbackCaptions);
  });
});

describe('sanitizeCaption', () => {
  it('garde une phrase simple', () => {
    expect(sanitizeCaption('Le cavalier va en f3.')).toBe('Le cavalier va en f3.');
  });

  it('rejette la notation SAN et UCI', () => {
    expect(sanitizeCaption('Nf3 est un bon coup.')).toBeNull();
    expect(sanitizeCaption('Il joue e2e4.')).toBeNull();
  });

  it('ne garde que la première phrase', () => {
    expect(sanitizeCaption('Le pion avance. Ensuite il menace.')).toBe('Le pion avance.');
  });

  it('tronque les phrases trop longues', () => {
    const long = 'a'.repeat(200);
    const out = sanitizeCaption(long);
    expect(out).toBeTruthy();
    expect(out!.length).toBeLessThanOrEqual(110);
    expect(out!.endsWith('…')).toBe(true);
  });
});

describe('Brièveté garantie en sortie (pas seulement demandée)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tronque une réponse de modèle trop longue', async () => {
    const longText = Array.from({ length: 40 }, (_, i) => `mot${i}`).join(' ');
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue(
      JSON.stringify({
        headline: longText,
        insights: [
          { kind: 'played_move', text: longText },
          { kind: 'mistake', text: longText },
          { kind: 'consequence', text: longText },
        ],
        takeaway: longText,
      })
    );

    // Coup « best » → registre strict : 1 insight, 16 mots.
    const card = await ExplanationEngine.generateCard(record({ classification: 'best' }));

    expect(card.insights).toHaveLength(1);
    expect(card.headline.split(/\s+/).length).toBeLessThanOrEqual(9);
    expect(card.insights[0].text.split(/\s+/).length).toBeLessThanOrEqual(17);
    expect(card.takeaway.split(/\s+/).length).toBeLessThanOrEqual(13);
  });

  it('laisse une réponse déjà courte intacte', async () => {
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue(
      '{"headline":"Bravo !","insights":[{"kind":"played_move","text":"Le cavalier va en f3."}],"takeaway":"Continuez ainsi."}'
    );
    const card = await ExplanationEngine.generateCard(record({ classification: 'brilliant' }));
    expect(card.headline).toBe('Bravo !');
    expect(card.insights[0].text).toBe('Le cavalier va en f3.');
  });
});