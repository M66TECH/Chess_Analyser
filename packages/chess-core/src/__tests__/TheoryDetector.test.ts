import { describe, it, expect } from 'vitest';
import { TheoryDetector } from '../explorer/TheoryDetector';
import { MoveClassifier } from '../pedagogy/MoveClassifier';
import type { OpeningData } from '../explorer/ExplorerCache';

describe('TheoryDetector (P2 - Moteur de décision théorique pur)', () => {
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  it('1. Consensus fort : qualifie un coup majeur en confirmed (master_statistics)', () => {
    const data: OpeningData = {
      white: 1000,
      draws: 800,
      black: 700,
      moves: [
        { uci: 'e2e4', san: 'e4', white: 500, draws: 400, black: 300 }, // 1200 / 2500 = 48%
        { uci: 'd2d4', san: 'd4', white: 400, draws: 300, black: 300 },
      ],
    };

    const res = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'e2e4',
      data,
    });

    expect(res.status).toBe('confirmed');
    expect(res.confidence).toBe('high');
    expect(res.evidence).toBe('found');
    expect(res.source).toBe('master_statistics');
    expect(res.masterGamesForMove).toBe(1200);
    expect(res.frequency).toBeCloseTo(0.48, 2);
  });

  it('2. 3e coup majeur dans une position riche (N_coup >= 100, f >= 8%)', () => {
    const data: OpeningData = {
      white: 1000,
      draws: 500,
      black: 500, // Total 2000
      moves: [
        { uci: 'e2e4', san: 'e4', white: 500, draws: 300, black: 300 }, // 1100 (55%)
        { uci: 'd2d4', san: 'd4', white: 350, draws: 150, black: 150 }, // 650 (32.5%)
        { uci: 'c2c4', san: 'c4', white: 80, draws: 40, black: 40 },   // 160 (8%)
      ],
    };

    const res = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'c2c4',
      data,
    });

    expect(res.status).toBe('confirmed');
    expect(res.confidence).toBe('high');
    expect(res.source).toBe('master_statistics');
    expect(res.masterGamesForMove).toBe(160);
    expect(res.frequency).toBeCloseTo(0.08, 2);
  });

  it('3. Coup marginal documenté : classé uncertain avec evidence found', () => {
    const data: OpeningData = {
      white: 60,
      draws: 30,
      black: 30, // Total 120
      moves: [
        { uci: 'e2e4', san: 'e4', white: 50, draws: 25, black: 25 },
        { uci: 'g1h3', san: 'Nh3', white: 1, draws: 1, black: 0 }, // 2 parties (1.6%)
      ],
    };

    const res = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'g1h3',
      data,
    });

    expect(res.status).toBe('uncertain');
    expect(res.confidence).toBe('medium');
    expect(res.evidence).toBe('found');
    expect(res.masterGamesForMove).toBe(2);
  });

  it('4. Sortie nette vérifiée (liste exhaustive moves.length < 12) : out_of_book avec verified_zero', () => {
    const data: OpeningData = {
      white: 100,
      draws: 50,
      black: 50, // Total 200 >= 50
      moves: [
        { uci: 'e2e4', san: 'e4', white: 60, draws: 30, black: 30 },
        { uci: 'd2d4', san: 'd4', white: 40, draws: 20, black: 20 },
      ], // 2 coups (< 12) -> liste exhaustive
    };

    const res = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'a2a4', // Absent de la liste exhaustive
      data,
    });

    expect(res.status).toBe('out_of_book');
    expect(res.confidence).toBe('high');
    expect(res.evidence).toBe('verified_zero');
    expect(res.masterGamesForMove).toBe(0);
  });

  it('5. Réponse saturée avec coupure N12 / N_pos < 1% : out_of_book avec not_returned', () => {
    // 12 coups, le 12e compte 3 parties sur 1000 (0.3% < 1%)
    const moves = Array.from({ length: 12 }, (_, i) => ({
      uci: `m${i}`,
      san: `M${i}`,
      white: 50,
      draws: 30,
      black: 20,
    }));
    // Force le 12e coup à 3 parties
    moves[11] = { uci: 'm11', san: 'M11', white: 2, draws: 1, black: 0 };

    const data: OpeningData = {
      white: 500,
      draws: 300,
      black: 200, // Total 1000
      moves,
    };

    const res = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'h2h4', // Absent du Top 12
      data,
    });

    expect(res.status).toBe('out_of_book');
    expect(res.confidence).toBe('high');
    expect(res.evidence).toBe('not_returned');
    expect(res.cutoffGames).toBe(3);
  });

  it('6. Réponse saturée avec coupure N12 / N_pos >= 1% (Cas Npos=50, N12=2) : uncertain obligatoire', () => {
    // N_pos = 50, N12 = 2 -> 2/50 = 4% >= 1% : certitude impossible !
    const moves = Array.from({ length: 12 }, (_, i) => ({
      uci: `m${i}`,
      san: `M${i}`,
      white: 2,
      draws: 1,
      black: 1,
    }));
    moves[11] = { uci: 'm11', san: 'M11', white: 1, draws: 1, black: 0 }; // 2 parties

    const data: OpeningData = {
      white: 25,
      draws: 15,
      black: 10, // Total 50
      moves,
    };

    const res = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'b1c3', // Absent du Top 12
      data,
    });

    expect(res.status).toBe('uncertain');
    expect(res.confidence).toBe('medium');
    expect(res.evidence).toBe('not_returned');
    expect(res.cutoffGames).toBe(2);
  });

  it('7. Position sans données de maîtres (N_pos === 0) : no_data, uncertain (pas de faux verified_zero)', () => {
    const data: OpeningData = {
      white: 0,
      draws: 0,
      black: 0,
      moves: [],
    };

    const res = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'e2e4',
      data,
    });

    expect(res.status).toBe('uncertain');
    expect(res.evidence).toBe('no_data');
    expect(res.source).toBe('insufficient_data');
    expect(res.confidence).toBe('low');
  });

  it('8. Position intermédiaire (30 <= N_pos < 50) sans coup répertorié : uncertain par défaut', () => {
    const data: OpeningData = {
      white: 20,
      draws: 10,
      black: 10, // Total 40
      moves: [
        { uci: 'e2e4', san: 'e4', white: 20, draws: 10, black: 10 },
      ],
    };

    const res = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'd2d4',
      data,
    });

    expect(res.status).toBe('uncertain');
    expect(res.confidence).toBe('medium');
  });

  it('9. Preuve canonique seule : source canonical_opening', () => {
    const data: OpeningData = {
      white: 0,
      draws: 0,
      black: 0,
      moves: [],
    };

    const res = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'e2e4',
      data,
      isCanonicalBookMove: true,
    });

    expect(res.status).toBe('confirmed');
    expect(res.source).toBe('canonical_opening');
    expect(res.confidence).toBe('high');
  });

  it('10. Preuve canonique ET validation statistique : source both', () => {
    const data: OpeningData = {
      white: 500,
      draws: 300,
      black: 200, // Total 1000
      moves: [
        { uci: 'e2e4', san: 'e4', white: 250, draws: 150, black: 100 }, // 500 parties (50%)
      ],
    };

    const res = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'e2e4',
      data,
      isCanonicalBookMove: true,
    });

    expect(res.status).toBe('confirmed');
    expect(res.source).toBe('both');
    expect(res.confidence).toBe('high');
  });

  it('11. Échec API ou timeout : unavailable et uncertain', () => {
    const res = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'e2e4',
      data: null,
    });

    expect(res.status).toBe('uncertain');
    expect(res.evidence).toBe('unavailable');
    expect(res.source).toBe('insufficient_data');
    expect(res.confidence).toBe('low');
  });

  it('12. Erreur tactique dans la théorie : theory est confirmed mais MoveClassifier renvoie blunder (non masqué)', () => {
    const data: OpeningData = {
      white: 500,
      draws: 300,
      black: 200,
      moves: [
        { uci: 'e2e4', san: 'e4', white: 250, draws: 150, black: 100 },
      ],
    };

    const theoryRes = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'e2e4',
      data,
    });
    expect(theoryRes.status).toBe('confirmed');

    // Fixture déterministe simulant une gaffe tactique (winDrop = 0.40, perte majeure de chances)
    const engineVerdict = MoveClassifier.classify(0.40, {
      isBestMove: false,
      isTheory: true, // transmis au classificateur
    });

    // L'erreur moteur reste visible et n'est plus écrasée en 'good' !
    expect(engineVerdict.classification).toBe('blunder');
    expect(engineVerdict.accuracy).toBeLessThan(50);
  });

  it('13. Sacrifice de Gambit sain : theory est confirmed et précision moteur réelle est préservée', () => {
    const data: OpeningData = {
      white: 500,
      draws: 300,
      black: 200,
      moves: [
        { uci: 'd7d5', san: 'd5', white: 200, draws: 150, black: 100 }, // 450 parties
      ],
    };

    const theoryRes = TheoryDetector.detect({
      fen: START_FEN,
      uci: 'd7d5',
      data,
    });
    expect(theoryRes.status).toBe('confirmed');

    // Fixture déterministe simulant un sacrifice avec légère perte théorique (winDrop = 0.05)
    const engineVerdict = MoveClassifier.classify(0.05, {
      isBestMove: false,
      isTheory: true,
    });

    // Coup théorique sain classé « book » (sans sur-étiquetage best/brilliant), accuracy réelle préservée
    expect(engineVerdict.classification).toBe('book');
    expect(engineVerdict.accuracy).toBeGreaterThan(80);
    expect(engineVerdict.accuracy).toBeLessThan(100);
  });
});
