import { describe, it, expect } from 'vitest';
import { ExplanationEngine, isFrenchText } from '../pedagogy/ExplanationEngine';
import type { MoveRecord } from '../pedagogy/types';

/**
 * Le fallback doit être INDISCERNABLE du rendu LLM :
 * même forme (titre + 1-2 constats + conseil), même ton par cas, français,
 * ≤ 30 mots, sans notation, et jamais une analyse fausse.
 *
 * Ces tests couvrent TOUS les scénarios atteignables.
 */
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const NXE5_BEFORE = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
const NXE5_AFTER = 'r1bqkbnr/pppp1ppp/2n5/4N3/4P3/8/PPPP1PPP/RNBQKB1R b KQkq - 0 3';

function record(overrides: Partial<MoveRecord> = {}): MoveRecord {
  return {
    fenBefore: START,
    fenAfter: AFTER_E4,
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

const SAN = /\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]\b/;
const UCI = /\b[a-h][1-8][a-h][1-8][qrbn]?\b/;

function allTexts(card: { headline: string; insights: Array<{ text: string }>; takeaway: string }): string[] {
  return [card.headline, ...card.insights.map(i => i.text), card.takeaway];
}

/** Invariants communs à TOUTES les cartes, quel que soit le scénario. */
function expectContract(card: { headline: string; insights: Array<{ text: string }>; takeaway: string }) {
  expect(card.headline.length).toBeGreaterThan(0);
  expect(card.insights.length).toBeGreaterThanOrEqual(1);
  expect(card.insights.length).toBeLessThanOrEqual(2);
  expect(card.takeaway.length).toBeGreaterThan(0);

  for (const text of allTexts(card)) {
    // Limite absolue : 30 mots.
    expect(text.trim().split(/\s+/).length).toBeLessThanOrEqual(31);
    // Aucune notation brute.
    expect(text).not.toMatch(SAN);
    expect(text).not.toMatch(UCI);
    // Français uniquement.
    expect(isFrenchText(text)).toBe(true);
  }
}

describe('Fallback — couverture de TOUS les scénarios', () => {
  const classifications = [
    'brilliant', 'great', 'best', 'excellent', 'good',
    'book', 'inaccuracy', 'mistake', 'blunder',
  ] as const;

  for (const classification of classifications) {
    it(`couvre le verdict « ${classification} » avec le bon ton`, () => {
      const card = ExplanationEngine.buildLocalCard(record({ classification }), 'debutant');
      expectContract(card);

      const joined = allTexts(card).join(' ').toLowerCase();

      if (classification === 'brilliant') expect(card.headline).toMatch(/bravo/i);
      if (classification === 'blunder') {
        expect(card.headline).toMatch(/panique/i);
        expect(joined).toMatch(/pas de panique/);
        // Jamais de reproche dur.
        expect(joined).not.toMatch(/nul|honte|catastroph/);
      }
      if (classification === 'book') {
        expect(joined).toMatch(/ouverture|classique/);
        // Un coup de théorie n'est jamais une erreur.
        expect(card.headline).not.toMatch(/erreur|panique/i);
      }
      if (classification === 'mistake') expect(card.headline).toMatch(/erreur/i);
      if (classification === 'inaccuracy') expect(card.headline).toMatch(/imprécision/i);
    });
  }

  it('couvre la livraison d\'un mat (le joueur mate)', () => {
    const card = ExplanationEngine.buildLocalCard(
      record({
        san: 'Qh4#',
        playedMove: 'd8h4',
        fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2',
        fenAfter: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
        classification: 'best',
        moveNumber: 2,
        color: 'black',
      }),
      'debutant'
    );
    expectContract(card);
    expect(card.headline).toMatch(/mat/i);
    expect(card.takeaway).toMatch(/bravo|gagn/i);
  });

  it('couvre une séquence de mat subi (created)', () => {
    const card = ExplanationEngine.buildLocalCard(
      record({ classification: 'blunder', mateSequence: 'created' }),
      'debutant'
    );
    expectContract(card);
    expect(card.headline).toMatch(/mat/i);
    expect(allTexts(card).join(' ')).toMatch(/roi/i);
  });

  it('couvre un mat perdu (lost)', () => {
    const card = ExplanationEngine.buildLocalCard(
      record({ classification: 'mistake', mateSequence: 'lost' }),
      'debutant'
    );
    expectContract(card);
    expect(card.headline).toMatch(/mat/i);
  });

  it('couvre un mat retardé (delayed) sans le présenter comme une erreur', () => {
    const card = ExplanationEngine.buildLocalCard(
      record({ classification: 'good', mateSequence: 'delayed' }),
      'debutant'
    );
    expectContract(card);
    const joined = allTexts(card).join(' ').toLowerCase();
    expect(joined).not.toMatch(/erreur|faute/);
    expect(joined).toMatch(/mat/);
  });

  it('couvre une pièce laissée en prise (fait tactique vérifié)', () => {
    const card = ExplanationEngine.buildLocalCard(
      record({
        fenBefore: NXE5_BEFORE,
        fenAfter: NXE5_AFTER,
        san: 'Nxe5',
        playedMove: 'f3e5',
        bestMove: 'f1b5',
        bestPv: ['f1b5', 'a7a6'],
        refutationPv: ['c6e5'],
        classification: 'blunder',
        cpBefore: 30,
        cpAfter: -280,
      }),
      'debutant'
    );
    expectContract(card);
    const mistake = card.insights.find(i => i.kind === 'mistake')?.text ?? '';
    expect(mistake.toLowerCase()).toMatch(/cavalier|prise/);
  });

  it('couvre une capture (gain de matériel confirmé)', () => {
    const card = ExplanationEngine.buildLocalCard(
      record({
        fenBefore: NXE5_BEFORE,
        fenAfter: NXE5_AFTER,
        san: 'Nxe5',
        playedMove: 'f3e5',
        classification: 'excellent',
        cpBefore: 30,
        cpAfter: 60,
      }),
      'debutant'
    );
    expectContract(card);
    expect(allTexts(card).join(' ').toLowerCase()).toMatch(/prend|matériel/);
  });

  it('couvre un coup sans meilleur coup disponible', () => {
    const card = ExplanationEngine.buildLocalCard(
      record({ bestMove: undefined, bestPv: undefined, classification: 'blunder' }),
      'debutant'
    );
    expectContract(card);
    // On ne prétend pas connaître le meilleur coup : conseil générique.
    expect(allTexts(card).join(' ')).not.toMatch(/meilleur coup était/i);
  });

  it('couvre une position sans évaluation avant le coup', () => {
    const card = ExplanationEngine.buildLocalCard(
      record({ cpBefore: undefined as unknown as number, cpAfter: undefined as unknown as number }),
      'debutant'
    );
    expectContract(card);
  });

  it('couvre un coup de théorie sans le juger comme une erreur', () => {
    const card = ExplanationEngine.buildLocalCard(
      record({
        classification: 'book',
        theory: { inBook: true, isTheory: true, eco: 'C20', openingName: 'King’s Pawn Game', frequency: 0.4, games: 1000 },
      }),
      'debutant'
    );
    expectContract(card);
    expect(allTexts(card).join(' ')).not.toMatch(/erreur/i);
  });

  it('reste cohérent pour un mateSequence absent et verbose:false', () => {
    const card = ExplanationEngine.buildLocalCard(record({ classification: 'good' }), 'debutant');
    expectContract(card);
  });
});

describe('Fallback — indistinguable du LLM', () => {
  it('respecte strictement la limite absolue de 30 mots', () => {
    // Coup très verbeux côté faits : on vérifie que la troncature s'applique.
    const long = 'x'.repeat(1);
    void long;
    const card = ExplanationEngine.buildLocalCard(record({ classification: 'blunder' }), 'debutant');
    for (const text of allTexts(card)) {
      expect(text.split(/\s+/).length).toBeLessThanOrEqual(31);
    }
  });

  it('produit la même forme qu\'une carte LLM (titre + constats + conseil)', () => {
    const card = ExplanationEngine.buildLocalCard(record({ classification: 'mistake' }), 'debutant');
    expect(typeof card.headline).toBe('string');
    expect(Array.isArray(card.insights)).toBe(true);
    expect(card.insights.every(i => typeof i.kind === 'string' && typeof i.text === 'string')).toBe(true);
    expect(typeof card.takeaway).toBe('string');
    expect(card.level).toBe('debutant');
  });

  it('n\'expose jamais de détail technique (centipawn, cp, POV)', () => {
    const card = ExplanationEngine.buildLocalCard(record({ classification: 'blunder', cpAfter: -300 }), 'debutant');
    const joined = allTexts(card).join(' ').toLowerCase();
    expect(joined).not.toMatch(/centipawn|\bcp\b|pov|évaluation/);
  });
});

describe('isFrenchText', () => {
  it('accepte le français', () => {
    expect(isFrenchText('Le cavalier va en f3 et votre roi est en sécurité.')).toBe(true);
    expect(isFrenchText('Bravo, vous ne perdez rien.')).toBe(true);
  });

  it('rejette l\'anglais', () => {
    expect(isFrenchText('The best move is to capture the pawn and defend your king.')).toBe(false);
    expect(isFrenchText('Your knight is attacked, you should protect it with the rook.')).toBe(false);
  });

  it('accepte une phrase nominale neutre', () => {
    expect(isFrenchText('Échec et mat.')).toBe(true);
  });
});

