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

    it('détecte l\'échec et le mat depuis la position résultante calculée (P0.2)', () => {
      // 1. Position en échec réel calculée sur fenAfter (même sans '+' dans le SAN)
      const foolsMateFen = 'rnbqkbnr/pppp1ppp/8/4p3/5PPq/8/PPPPP2P/RNBQKBNR w KQkq - 1 3';
      const ctxCheck = buildExplanationContext({
        record: record({ fenAfter: foolsMateFen, san: 'Qh4' }),
      });
      expect(ctxCheck.played.is_check).toBe(true);
      expect(ctxCheck.played.is_mate).toBe(true);

      // 2. Si fenAfter est indisponible, repli gracieux sur le SAN
      const ctxFallback = buildExplanationContext({
        record: record({ fenAfter: '', san: 'Qh5+' }),
      });
      expect(ctxFallback.played.is_check).toBe(true);
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
    expect(card.headline).toBe('Le meilleur coup');
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
    expect(card.headline).toBe('Pas de panique');
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
    expect(card.headline).toBe('Pas de panique');
    expect(card.insights.length).toBeGreaterThan(0);
  });

  it('retombe sur l\'explication locale si le modèle renvoie du vide', async () => {
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue('');
    const card = await ExplanationEngine.generateCard(record());
    expect(card.headline).toBe('Le meilleur coup');
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

    expect(card.headline).toBe('Pas de panique');

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

describe('ExplanationEngine.verifyCardFactualConsistency (P0.1)', () => {
  const dummyCtx = buildExplanationContext({
    record: record({
      fenBefore: START,
      fenAfter: AFTER_E4,
      playedMove: 'e2e4',
      san: 'e4',
      classification: 'best',
    }),
    playedPiece: 'pion',
  });

  it('valide une carte factuellement cohérente', () => {
    const card = {
      headline: 'Bon coup',
      insights: [{ kind: 'played_move' as const, text: 'Votre pion prend le centre.' }],
      takeaway: 'Continuez.',
    };
    const res = ExplanationEngine.verifyCardFactualConsistency(card, dummyCtx.tactical_facts, dummyCtx);
    expect(res.isValid).toBe(true);
  });

  it('rejette une affirmation inventée de pièce en prise (P0.1)', () => {
    const card = {
      headline: 'Erreur',
      insights: [{ kind: 'mistake' as const, text: 'Votre dame est en prise et sans défense.' }],
      takeaway: 'Attention.',
    };
    const res = ExplanationEngine.verifyCardFactualConsistency(card, dummyCtx.tactical_facts, dummyCtx);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('pièce en prise');
  });

  it('rejette une affirmation inventée de clouage (P0.1)', () => {
    const card = {
      headline: 'Problème',
      insights: [{ kind: 'mistake' as const, text: 'Ce clouage vous fait perdre du matériel.' }],
      takeaway: 'Déclouez.',
    };
    const res = ExplanationEngine.verifyCardFactualConsistency(card, dummyCtx.tactical_facts, dummyCtx);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('clouage');
  });

  it('rejette une affirmation inventée de mat (P0.1)', () => {
    const card = {
      headline: 'Échec et mat',
      insights: [{ kind: 'mistake' as const, text: 'Vous allez vous faire mater immédiatement.' }],
      takeaway: 'Paradez le mat.',
    };
    const res = ExplanationEngine.verifyCardFactualConsistency(card, dummyCtx.tactical_facts, dummyCtx);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('mat');
  });

  it('rejette une affirmation inventée de fourchette sans double attaque certifiée', () => {
    const card = {
      headline: 'Attaque',
      insights: [{ kind: 'mistake' as const, text: 'Cette fourchette gagne votre dame.' }],
      takeaway: 'Évitez les fourchettes.',
    };
    const res = ExplanationEngine.verifyCardFactualConsistency(card, dummyCtx.tactical_facts, dummyCtx);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('fourchette');
  });

  it('rejette une recommandation de coup alternatif non alignée avec Stockfish', () => {
    const card = {
      headline: 'Mauvais choix',
      insights: [{ kind: 'mistake' as const, text: 'Vous devriez jouer Dxh5 pour attaquer.' }],
      takeaway: 'Jouez actif.',
    };
    const res = ExplanationEngine.verifyCardFactualConsistency(card, dummyCtx.tactical_facts, dummyCtx);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('Recommandation');
  });

  it('rejette une affirmation de position équilibrée quand l’évaluation est déséquilibrée', () => {
    const unbalCtx = {
      ...dummyCtx,
      evaluation: {
        ...dummyCtx.evaluation,
        after: -350, // -3.5 pions !
      },
    };
    const card = {
      headline: 'Calme',
      insights: [{ kind: 'played_move' as const, text: 'La position est équilibrée et sans danger.' }],
      takeaway: 'Continuez.',
    };
    const res = ExplanationEngine.verifyCardFactualConsistency(card, unbalCtx.tactical_facts, unbalCtx);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('position équilibrée');
  });

  it('rejette une pièce citée absente de la case sur l’échiquier', () => {
    // Il n'y a pas de tour en a4 sur la position initiale ni après e4
    const card = {
      headline: 'Erreur',
      insights: [{ kind: 'mistake' as const, text: 'Votre tour en a4 est mal placée.' }],
      takeaway: 'Replacez-la.',
    };
    const res = ExplanationEngine.verifyCardFactualConsistency(card, dummyCtx.tactical_facts, dummyCtx);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('Affirmation hallucinatoire');
  });

  it('rejette une recommandation non-canonique de coup alternatif (G1)', () => {
    const card = {
      headline: 'Autre idée',
      insights: [{ kind: 'mistake' as const, text: 'd5 était une excellente idée dans cette position.' }],
      takeaway: 'Cherchez les bons coups.',
    };
    const res = ExplanationEngine.verifyCardFactualConsistency(card, dummyCtx.tactical_facts, dummyCtx);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('Recommandation');
  });

  it('rejette une affirmation de position favorable contredite par une évaluation négative (G2)', () => {
    const losingCtx = {
      ...dummyCtx,
      evaluation: {
        ...dummyCtx.evaluation,
        after: -320,
      },
    };
    const card = {
      headline: 'Succès',
      insights: [{ kind: 'played_move' as const, text: 'Votre position est bonne et vous avez l\'avantage.' }],
      takeaway: 'Continuez.',
    };
    const res = ExplanationEngine.verifyCardFactualConsistency(card, losingCtx.tactical_facts, losingCtx);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('position favorable');
  });

  it('rejette une affirmation de menace directe inventée (G3)', () => {
    // dummyCtx : e2e4 joué par les blancs, le pion en e4 attaque d5 et f5, pas la dame noire en d8
    const card = {
      headline: 'Menace',
      insights: [{ kind: 'played_move' as const, text: 'Votre pion menace la dame adverse.' }],
      takeaway: 'Attaquez.',
    };
    const res = ExplanationEngine.verifyCardFactualConsistency(card, dummyCtx.tactical_facts, dummyCtx);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('menace inventée');
  });

  it('rejette une incohérence de camp / couleur', () => {
    // dummyCtx a played.color = 'white'
    const card = {
      headline: 'Action',
      insights: [{ kind: 'played_move' as const, text: 'Les noirs jouent ce coup pour attaquer.' }],
      takeaway: 'Soyez vigilant.',
    };
    const res = ExplanationEngine.verifyCardFactualConsistency(card, dummyCtx.tactical_facts, dummyCtx);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('couleur');
  });

  it('generateCard bascule sur le fallback local en mode dégradé lors d\'une hallucination LLM (P0.1)', async () => {
    vi.spyOn(RiverAPI, 'complete').mockResolvedValue(
      '{"headline":"Grave erreur","insights":[{"kind":"mistake","text":"Votre tour est en prise et sans défense."}],"takeaway":"Protégez votre tour."}'
    );
    const card = await ExplanationEngine.generateCard(record({ classification: 'good' }));
    expect(card.degraded).toBe(true);
    // Le texte ne contient pas l\'affirmation hallucinée mais le repli certifié
    expect(card.headline).toBe('Bon coup');
    expect(card.insights[0].text).not.toContain('Votre tour est en prise');
  });
});
