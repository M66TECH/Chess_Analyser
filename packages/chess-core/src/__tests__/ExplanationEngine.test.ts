import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExplanationEngine } from '../pedagogy/ExplanationEngine';
import { RiverAPI } from '../pedagogy/RiverAPI';
import { buildExplanationContext, estimatePhase, pieceToFr } from '../pedagogy/ExplanationContext';
import type { MoveRecord } from '../pedagogy/types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function record(overrides: Partial<MoveRecord> = {}): MoveRecord {
  return {
    fenBefore: START,
    fenAfter: AFTER_E4,
    playedMove: 'e2e4',
    bestMove: 'e2e4',
    cpBefore: 20,
    cpAfter: 25,
    winProbBefore: 0,
    winProbAfter: 0,
    accuracy: 100,
    classification: 'best',
    moveNumber: 1,
    color: 'white',
    san: 'e4',
    nodeId: 'node_1',
    ...overrides,
  };
}

describe('ExplanationContext', () => {
  describe('pieceToFr', () => {
    it('traduit les rôles chessops', () => {
      expect(pieceToFr('knight')).toBe('cavalier');
      expect(pieceToFr('queen')).toBe('dame');
      expect(pieceToFr('pawn')).toBe('pion');
    });

    it('renvoie undefined pour une valeur absente', () => {
      expect(pieceToFr(undefined)).toBeUndefined();
    });
  });

  describe('estimatePhase', () => {
    it('détecte l\'ouverture, le milieu et la finale', () => {
      expect(estimatePhase(5, 32)).toBe('ouverture');
      expect(estimatePhase(25, 24)).toBe('milieu');
      expect(estimatePhase(40, 10)).toBe('finale');
    });
  });

  describe('buildExplanationContext', () => {
    it('expose les évaluations POV Blanc sans les réinverser (même pour les Noirs)', () => {
      // cpBefore/cpAfter sont déjà POV Blanc (normalisés par le pipeline).
      // Un coup des Noirs qui fait passer le score de +25 à +20 n'a rien perdu.
      const ctx = buildExplanationContext({
        record: record({
          color: 'black',
          san: 'e5',
          playedMove: 'e7e5',
          cpBefore: 25,
          cpAfter: 20,
        }),
        playedPiece: 'pion',
      });
      expect(ctx.evaluation.before).toBe(25);
      expect(ctx.evaluation.after).toBe(20);
      expect(ctx.evaluation.player_loss_cp).toBe(0);
    });

    it('calcule la perte du joueur pour les Blancs', () => {
      const ctx = buildExplanationContext({
        record: record({ cpBefore: 120, cpAfter: 40 }),
        playedPiece: 'cavalier',
      });
      expect(ctx.evaluation.player_loss_cp).toBe(80);
    });

    it('n\'indique aucun écart quand le coup joué est le meilleur', () => {
      const ctx = buildExplanationContext({
        record: record({ playedMove: 'e2e4', bestMove: 'e2e4' }),
      });
      expect(ctx.best?.uci).toBe('e2e4');
      expect(ctx.best?.centipawn_gap).toBeNull();
    });

    it('mesure l\'écart quand un meilleur coup existe', () => {
      const ctx = buildExplanationContext({
        record: record({ playedMove: 'd2d4', bestMove: 'e2e4', cpBefore: 100, cpAfter: 30 }),
        bestMoveSan: 'e4',
      });
      expect(ctx.best?.san).toBe('e4');
      expect(ctx.best?.centipawn_gap).toBe(70);
    });

    it('détecte l\'échec depuis la notation SAN', () => {
      const ctx = buildExplanationContext({ record: record({ san: 'Qh5+' }) });
      expect(ctx.played.is_check).toBe(true);
    });

    it('transmet la théorie Lichess sans la déformer', () => {
      const ctx = buildExplanationContext({
        record: record({
          theory: {
            inBook: true,
            isTheory: true,
            eco: 'B00',
            openingName: "King's Pawn Game",
            frequency: 0.5123,
            games: 1309466,
          },
        }),
      });
      expect(ctx.opening).toEqual({
        name: "King's Pawn Game",
        eco: 'B00',
        in_book: true,
        is_theory_move: true,
        frequency_percent: 51,
      });
    });
  });
});

describe('ExplanationEngine.parseCard', () => {
  it('parse un JSON valide', () => {
    const card = ExplanationEngine.parseCard(
      '{"headline":"Bon coup","insights":[{"kind":"played_move","text":"e4 occupe le centre."}],"takeaway":"Continuez."}'
    );
    expect(card?.headline).toBe('Bon coup');
    expect(card?.insights).toHaveLength(1);
    expect(card?.insights[0].kind).toBe('played_move');
    expect(card?.takeaway).toBe('Continuez.');
  });

  it('tolère les fences Markdown', () => {
    const card = ExplanationEngine.parseCard(
      '```json\n{"headline":"X","insights":[],"takeaway":"Y"}\n```'
    );
    expect(card?.headline).toBe('X');
  });

  it('ignore le texte autour de l\'objet JSON', () => {
    const card = ExplanationEngine.parseCard(
      'Voici la fiche : {"headline":"X","insights":[],"takeaway":"Y"} fin.'
    );
    expect(card?.headline).toBe('X');
  });

  it('rejette un kind inconnu mais garde les valides', () => {
    const card = ExplanationEngine.parseCard(
      '{"headline":"X","insights":[{"kind":"hallucination","text":"non"},{"kind":"mistake","text":"oui"}],"takeaway":"Y"}'
    );
    expect(card?.insights).toHaveLength(1);
    expect(card?.insights[0].kind).toBe('mistake');
  });

  it('rejette les entrées invalides', () => {
    expect(ExplanationEngine.parseCard('')).toBeNull();
    expect(ExplanationEngine.parseCard('pas du json')).toBeNull();
    expect(ExplanationEngine.parseCard('{}')).toBeNull();
    expect(ExplanationEngine.parseCard('{"headline":"","insights":[],"takeaway":""}')).toBeNull();
  });
});

describe('ExplanationEngine.fallbackCard', () => {
  it('explique un coup correct sans le présenter comme une erreur', () => {
    const ctx = buildExplanationContext({ record: record(), playedPiece: 'pion' });
    const card = ExplanationEngine.fallbackCard(ctx, 'intermediaire');
    expect(card.headline).toBe('Bon coup');
    expect(card.insights.some(i => i.kind === 'played_move')).toBe(true);
    expect(card.insights.some(i => i.kind === 'mistake')).toBe(false);
    expect(card.takeaway.length).toBeGreaterThan(0);
  });

  it('explique une gaffe et rappelle le meilleur coup', () => {
    const ctx = buildExplanationContext({
      record: record({
        san: 'Nh3',
        playedMove: 'g1h3',
        bestMove: 'e2e4',
        classification: 'blunder',
        cpBefore: 20,
        cpAfter: -280,
        accuracy: 12,
      }),
      bestMoveSan: 'e4',
      playedPiece: 'cavalier',
    });
    const card = ExplanationEngine.fallbackCard(ctx, 'debutant');
    expect(card.headline).toBe('Grosse erreur');
    expect(card.insights.some(i => i.kind === 'mistake')).toBe(true);
    expect(card.insights.some(i => i.kind === 'missed_move')).toBe(true);
    expect(card.insights.find(i => i.kind === 'missed_move')?.text).toContain('e4');
  });

  it('signale une capture confirmée uniquement si la donnée existe', () => {
    const withCapture = buildExplanationContext({
      record: record({ san: 'exd5', playedMove: 'e4d5', classification: 'excellent' }),
      playedPiece: 'pion',
      capturedPiece: 'pion',
    });
    const card = ExplanationEngine.fallbackCard(withCapture, 'intermediaire');
    expect(card.insights.some(i => i.text.includes('prend'))).toBe(true);
  });
});

describe('ExplanationEngine.generateCard', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('utilise la réponse du modèle quand elle est valide', async () => {
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue(
      '{"headline":"Coup solide","insights":[{"kind":"played_move","text":"Le pion prend le centre."}],"takeaway":"Bien joué."}'
    );
    const card = await ExplanationEngine.generateCard(record());
    expect(card.headline).toBe('Coup solide');
    expect(card.level).toBe('intermediaire');
  });

  it('retombe sur une explication locale si le modèle échoue', async () => {
    vi.spyOn(RiverAPI, 'complete').mockRejectedValue(new Error('network down'));
    const card = await ExplanationEngine.generateCard(record({ classification: 'blunder', cpAfter: -300 }));
    expect(card.headline).toBe('Grosse erreur');
    expect(card.insights.length).toBeGreaterThan(0);
  });

  it('retombe sur l\'explication locale si le modèle renvoie du vide', async () => {
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue('');
    const card = await ExplanationEngine.generateCard(record());
    expect(card.headline).toBe('Bon coup');
  });

  it('n\'envoie au modèle que des faits issus de l\'analyse', async () => {
    const spy = vi.spyOn(RiverAPI, 'complete').mockResolvedValue(
      '{"headline":"X","insights":[],"takeaway":"Y"}'
    );
    await ExplanationEngine.generateCard(record({ classification: 'mistake', cpBefore: 50, cpAfter: 10 }));

    const prompt = spy.mock.calls[0][0] as string;
    expect(prompt).toContain('"player_loss_cp": 40');
    expect(prompt).toContain('"classification": "mistake"');
    expect(prompt).toContain('"move_number": 1');
  });

  it('reste court, sans notation et sans déballer la variante (nouvelle consigne)', () => {
    // Position où le cavalier va en e5 se faire prendre par le pion c6.
    const fenBefore = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const fenAfter = 'r1bqkbnr/pppp1ppp/2n5/4N3/4P3/8/PPPP1PPP/RNBQKB1R b KQkq - 0 3';
    const blunderRec = record({
      fenBefore,
      fenAfter,
      san: 'Nxe5',
      playedMove: 'f3e5',
      bestMove: 'f1b5',
      bestPv: ['f1b5', 'a7a6', 'b5a4'],
      refutationPv: ['c6e5', 'd2d4'],
      classification: 'blunder',
      cpBefore: 30,
      cpAfter: -280,
      accuracy: 10,
      moveNumber: 3,
      color: 'white',
    });

    const card = ExplanationEngine.buildLocalCard(blunderRec, 'debutant');

    expect(card.headline).toBe('Grosse erreur');

    // Consigne : 1 ou 2 constats max, phrases courtes.
    expect(card.insights.length).toBeLessThanOrEqual(2);
    for (const insight of card.insights) {
      expect(insight.text.length).toBeLessThanOrEqual(120);
    }

    // Consigne : aucune notation brute (Nf3, Bb5, e2e4...).
    const SAN = /\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]\b/;
    const UCI = /\b[a-h][1-8][a-h][1-8]\b/;
    const allText = [card.headline, card.takeaway, ...card.insights.map(i => i.text)].join(' ');
    expect(allText).not.toMatch(SAN);
    expect(allText).not.toMatch(UCI);

    // La variante n'est plus racontée en texte : elle est montrée sur
    // l'échiquier via le bouton « Montrer sur l''échiquier ».
    expect(card.insights.some(i => i.kind === 'consequence')).toBe(false);
    expect(card.takeaway.length).toBeGreaterThan(0);
  });
});
