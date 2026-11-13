import { describe, it, expect } from 'vitest';
import { MoveClassifier } from '../pedagogy/MoveClassifier';
import {
  detectMaterialSacrifice,
  calculateSacrificeScore,
} from '../pedagogy/BrilliancyEngine';

describe('P2.13 — Calibration des Coups Brillants (!!) et Grands Coups (!)', () => {
  describe('Formule composite et calcul des composants', () => {
    it('calcule la note de sacrifice C_sac selon l’échelle de matériel', () => {
      expect(calculateSacrificeScore(9)).toBe(1.0); // Dame
      expect(calculateSacrificeScore(5)).toBe(0.85); // Tour
      expect(calculateSacrificeScore(3)).toBe(0.70); // Pièce mineure
      expect(calculateSacrificeScore(2)).toBe(0.55); // Qualité
      expect(calculateSacrificeScore(1)).toBe(0.35); // Pion
      expect(calculateSacrificeScore(0)).toBe(0.0);
    });

    it('détecte un sacrifice de pièce à partir du FEN et de la variante adverse', () => {
      // Position où les Blancs jouent Rxd4 (tour blanche en d1 prend d4) et les Noirs répondent cxd4
      // FEN simplifié : Tour blanche d1, pion noir c5
      const fen = 'rnbqkbnr/pp1ppppp/8/2p5/3P4/8/PPP1PPPP/RN1QKBNR w KQkq - 0 1';
      // Jouer d4xc5 (prend un pion) puis Noir répond b7-b6 (ne reprend pas)
      const sac = detectMaterialSacrifice(fen, 'd4c5', ['b7b6']);
      expect(sac).toBe(0);
    });
  });

  describe('Corpus de validation des positions canoniques', () => {
    it('1. Fischer vs Byrne (1956) : 17...Be6!! (Sacrifice de dame légendaire)', () => {
      // Position après 17.Fg5 : Fischer joue 17...Be6!! laissant sa Dame d8 en prise (18.Fxb6)
      const fenBefore = 'r2q1rk1/pp2ppbp/1np2np1/2B5/2BP4/1QN1PN2/PP3PPP/R4RK1 b - - 0 1';
      const result = MoveClassifier.classify(0, {
        isBestMove: true,
        fenBefore,
        playedMove: 'c8e6',
        pv: ['c8e6', 'c5b6', 'e6c4'],
        sacrificeValue: 9, // Dame sacrifiée
        multiPvGap: 0.20,
        prevScore: { cp: 80 },
        nextScore: { cp: 160 },
      });

      expect(result.classification).toBe('brilliant');
      expect(result.brilliancyScore).toBeGreaterThanOrEqual(0.75);
      expect(result.brilliancyComponents?.cSac).toBe(1.0);
    });

    it('2. Kasparov vs Topalov (1999) : 24.Rxd4!! (Immortal de Kasparov)', () => {
      // 24.Rxd4!! sacrifice de tour
      const result = MoveClassifier.classify(0, {
        isBestMove: true,
        sacrificeValue: 5, // Tour
        multiPvGap: 0.18,
        prevScore: { cp: 120 },
        nextScore: { cp: 210 },
      });

      expect(result.classification).toBe('brilliant');
      expect(result.brilliancyScore).toBeGreaterThanOrEqual(0.70);
      expect(result.brilliancyComponents?.cSac).toBe(0.85);
    });

    it('3. Levon Aronian vs Anand (2013) : 15...Bc5!! (Sacrifice de pièce mineure)', () => {
      const result = MoveClassifier.classify(0, {
        isBestMove: true,
        sacrificeValue: 3, // Fou
        multiPvGap: 0.15,
        prevScore: { cp: 50 },
        nextScore: { cp: 140 },
      });

      expect(result.classification).toBe('brilliant');
      expect(result.brilliancyScore).toBeGreaterThanOrEqual(0.70);
    });

    it('4. Paul Morphy (Opera Game) : 13.Rxd7! (Grand coup tactique / sacrifice de qualité)', () => {
      const result = MoveClassifier.classify(0, {
        isBestMove: true,
        sacrificeValue: 2, // Tour contre Cavalier/Fou
        multiPvGap: 0.16,
        prevScore: { cp: 220 },
        nextScore: { cp: 340 },
      });

      expect(result.classification).toBe('great');
    });

    it('5. Seul coup salvateur crucial sous forte pression : Grand Coup (!)', () => {
      // Pas de sacrifice de pièce, mais le SEUL coup empêchant la défaite immédiate (PV2 perd)
      const result = MoveClassifier.classify(0, {
        isBestMove: true,
        sacrificeValue: 0,
        multiPvGap: 0.22, // Écart majeur entre le 1er et le 2e coup
        prevScore: { cp: -150 },
        nextScore: { cp: -140 },
      });

      expect(result.classification).toBe('great');
    });

    it('6. Contrôle négatif 1 : Simple reprise d’une pièce adverse (aucun sacrifice)', () => {
      // Mange la Dame adverse en prise : c'est le meilleur coup, mais PAS un coup brillant
      const result = MoveClassifier.classify(0, {
        isBestMove: true,
        sacrificeValue: 0,
        multiPvGap: 0.05,
        prevScore: { cp: 200 },
        nextScore: { cp: 210 },
      });

      expect(result.classification).toBe('best');
    });

    it('7. Contrôle négatif 2 : Sacrifice dans une position déjà écrasante (+12.0)', () => {
      // Joueur déjà à +1200 cp : sacrifier une pièce est superficiel, pas un coup d’anthologie
      const result = MoveClassifier.classify(0, {
        isBestMove: true,
        sacrificeValue: 3,
        multiPvGap: 0.02,
        prevScore: { cp: 1200 },
        nextScore: { cp: 1180 },
      });

      expect(result.classification).toBe('best');
    });

    it('8. Contrôle négatif 3 : Pseudo-sacrifice qui est en réalité une gaffe', () => {
      // Donner sa dame sans compensation (winDrop = 0.50, perte de 50% de chances)
      const result = MoveClassifier.classify(0.50, {
        isBestMove: false,
        sacrificeValue: 9,
        prevScore: { cp: 50 },
        nextScore: { cp: -600 },
      });

      expect(result.classification).toBe('blunder');
    });

    it('9. Contrôle négatif 4 : Coup théorique d’ouverture (classé « book », jamais « best » ni « brilliant »)', () => {
      // 1.e4 est standard
      const result = MoveClassifier.classify(0, {
        isBestMove: true,
        isTheory: true,
        sacrificeValue: 0,
        multiPvGap: 0.01,
        prevScore: { cp: 15 },
        nextScore: { cp: 15 },
      });

      expect(result.classification).toBe('book');
    });

    it('10. Contrôle négatif 5 : Coup calme alternatif sans perte', () => {
      const result = MoveClassifier.classify(0.02, {
        isBestMove: false,
        sacrificeValue: 0,
        prevScore: { cp: 50 },
        nextScore: { cp: 45 },
      });

      expect(result.classification).toBe('excellent');
    });
  });
});
