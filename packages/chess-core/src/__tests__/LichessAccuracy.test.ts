import { describe, it, expect } from 'vitest';
import {
  accuracyFromWinPercent,
  ceilCp,
  gameAccuracy,
  INITIAL_CP,
  meanCentipawnLoss,
  moveAccuracy,
  phaseAccuracies,
  povChances,
  povDiff,
  winPercentFromCentiPawns,
  winPercentFromMate,
  winPercentFromScore,
  winningChances,
} from '../analysis/LichessAccuracy';

/**
 * Ces tests verrouillent la fidélité aux formules de Lichess.
 * Les valeurs de référence sont calculées depuis le code Scala/TS source
 * (scalachess `eval.scala`, lila `AccuracyPercent.scala`), pas recopiées à vue.
 */
describe('LichessAccuracy', () => {
  describe('ceilCp (Cp.ceiled)', () => {
    it('plafonne à ±1000 sans modifier les valeurs normales', () => {
      expect(ceilCp(50_000)).toBe(1000);
      expect(ceilCp(-50_000)).toBe(-1000);
      expect(ceilCp(0)).toBe(0);
      expect(ceilCp(999)).toBe(999);
      expect(ceilCp(-1000)).toBe(-1000);
    });
  });

  describe('winningChances (échelle [-1, +1])', () => {
    it('vaut 0 pour une position égale', () => {
      expect(winningChances(0)).toBe(0);
    });

    it('est symétrique', () => {
      expect(winningChances(300)).toBeCloseTo(-winningChances(-300), 12);
    });

    it('applique ceilCp avant la formule', () => {
      expect(winningChances(50_000)).toBe(winningChances(1000));
    });

    it('reproduit exactement la constante Lichess', () => {
      for (const cp of [-500, -100, 0, 100, 500]) {
        const expected = Math.min(1, Math.max(-1, 2 / (1 + Math.exp(-0.00368208 * ceilCp(cp))) - 1));
        expect(winningChances(cp)).toBeCloseTo(expected, 12);
      }
    });

    it('tend vers les extrêmes sans les atteindre (cp plafonné à ±1000)', () => {
      // Valeurs de référence : 2/(1+exp(-0.00368208*1000))-1 = 0.950895
      expect(winningChances(1000)).toBeCloseTo(0.950895, 5);
      expect(winningChances(-1000)).toBeCloseTo(-0.950895, 5);
      expect(winningChances(1000)).toBeLessThanOrEqual(1);
      expect(winningChances(-1000)).toBeGreaterThanOrEqual(-1);
    });
  });

  describe('winPercentFromCentiPawns (échelle [0, 100])', () => {
    it('vaut 50 pour une position égale', () => {
      expect(winPercentFromCentiPawns(0)).toBe(50);
    });

    it('respecte la formule 50 + 50 * winningChances', () => {
      for (const cp of [-800, -200, 0, 200, 800]) {
        expect(winPercentFromCentiPawns(cp)).toBeCloseTo(50 + 50 * winningChances(cp), 12);
      }
    });

    it('reste borné dans [0, 100]', () => {
      expect(winPercentFromCentiPawns(99_999)).toBeLessThanOrEqual(100);
      expect(winPercentFromCentiPawns(-99_999)).toBeGreaterThanOrEqual(0);
    });

    it('un mat vaut CP_CEILING (±1000) → 97.54 / 2.46 sur l\'échelle WinPercent', () => {
      // fromMate = fromCentiPawns(±1000) : Lichess ne renvoie pas exactement 100.
      expect(winPercentFromMate(3)).toBe(winPercentFromCentiPawns(1000));
      expect(winPercentFromMate(-3)).toBe(winPercentFromCentiPawns(-1000));
      expect(winPercentFromMate(1)).toBeCloseTo(97.5447, 3);
      expect(winPercentFromMate(-1)).toBeCloseTo(2.4553, 3);
    });

    it('fromScore privilégie le mat sur les centipions', () => {
      expect(winPercentFromScore({ mate: 2, cp: 0 })).toBe(winPercentFromMate(2));
      expect(winPercentFromScore({ cp: 250 })).toBe(winPercentFromCentiPawns(250));
    });
  });

  describe('povChances / povDiff', () => {
    it('inverse les chances pour les Noirs', () => {
      expect(povChances('black', { cp: 200 })).toBeCloseTo(-povChances('white', { cp: 200 }), 12);
    });

    it('povDiff divise par 2', () => {
      const diff = povDiff('white', { cp: 400 }, { cp: 0 });
      const expected = (povChances('white', { cp: 400 }) - povChances('white', { cp: 0 })) / 2;
      expect(diff).toBeCloseTo(expected, 12);
    });

    it('un mat donne une différence maximale', () => {
      expect(povDiff('white', { mate: 1 }, { cp: 0 })).toBeGreaterThan(0.4);
    });
  });

  describe('accuracyFromWinPercent (fromWinPercents)', () => {
    it('vaut 100 si le joueur n\'a rien perdu', () => {
      expect(accuracyFromWinPercent(50, 50)).toBe(100);
      expect(accuracyFromWinPercent(50, 80)).toBe(100);
    });

    it('reproduit la courbe Lichess au point de référence 20 points', () => {
      // 103.1668100711649 * exp(-0.04354415386753951 * 20) - 3.166924740191411 + 1
      const expected = 103.1668100711649 * Math.exp(-0.04354415386753951 * 20) - 3.166924740191411 + 1;
      expect(accuracyFromWinPercent(70, 50)).toBeCloseTo(expected, 10);
      expect(accuracyFromWinPercent(70, 50)).toBeCloseTo(41.0168, 3);
    });

    it('décroît avec la perte et reste dans [0, 100]', () => {
      const light = accuracyFromWinPercent(60, 50);
      const heavy = accuracyFromWinPercent(100, 50);
      expect(light).toBeGreaterThan(heavy);
      expect(heavy).toBeGreaterThanOrEqual(0);
      expect(light).toBeLessThanOrEqual(100);
    });

    it('tombe à 0 pour une perte de 100 points', () => {
      expect(accuracyFromWinPercent(100, 0)).toBe(0);
    });
  });

  describe('moveAccuracy', () => {
    it('ne pénalise pas un coup qui améliore la position', () => {
      const result = moveAccuracy({ cp: 0 }, { cp: 150 });
      expect(result.accuracy).toBe(100);
      expect(result.winDrop).toBeLessThan(0);
      expect(result.centipawnLoss).toBe(0);
    });

    it('est indépendante du camp : ne traite que des évaluations POV joueur', () => {
      // Lichess inverse les évaluations des Noirs AVANT le calcul, donc la
      // fonction ne voit jamais de couleur. Une même paire POV donne le même
      // résultat ; c'est à l'appelant d'inverser (cf. meanCentipawnLoss).
      const a = moveAccuracy({ cp: 300 }, { cp: 0 });
      const b = moveAccuracy({ cp: 300 }, { cp: 0 });
      expect(a).toEqual(b);
      expect(a.centipawnLoss).toBe(300);
    });

    it('calcule la perte en points de % (échelle WinPercent)', () => {
      const { winDrop } = moveAccuracy({ cp: 200 }, { cp: 0 });
      const expected = winPercentFromCentiPawns(200) - winPercentFromCentiPawns(0);
      expect(winDrop).toBeCloseTo(expected, 10);
      expect(winDrop).toBeCloseTo(17.62, 1);
    });

    it('calcule la perte en centipions, plafonnée à 0', () => {
      expect(moveAccuracy({ cp: 200 }, { cp: 50 }).centipawnLoss).toBe(150);
      expect(moveAccuracy({ cp: 50 }, { cp: 200 }).centipawnLoss).toBe(0);
    });

    it('traite un mat comme une position extrême', () => {
      // Mat contre nous : de l'égalité à une position perdue.
      const lose = moveAccuracy({ cp: 0 }, { mate: -3 });
      expect(lose.accuracy).toBeLessThan(15);
      expect(lose.centipawnLoss).toBe(1000);

      // Mat pour nous : c'est un gain, aucune perte.
      const win = moveAccuracy({ cp: 0 }, { mate: 3 });
      expect(win.accuracy).toBe(100);
      expect(win.centipawnLoss).toBe(0);
    });
  });

  describe('meanCentipawnLoss (AccuracyCP.mean)', () => {
    it('retourne 0 sans coup', () => {
      expect(meanCentipawnLoss([], 'white')).toBe(0);
    });

    it('moyenne les pertes, en ignorant les gains', () => {
      // White: 100→50 perd 50 ; 50→150 gagne (0) ; moyenne = 50/2 = 25
      expect(meanCentipawnLoss([
        { before: 100, after: 50 },
        { before: 50, after: 150 },
      ], 'white')).toBe(25);
    });

    it('interprète les évaluations du point de vue du camp demandé', () => {
      // POV Blanc : 300 → 0 = perte de 300 pour Blanc, gain pour Noir.
      expect(meanCentipawnLoss([{ before: 300, after: 0 }], 'white')).toBe(300);
      expect(meanCentipawnLoss([{ before: 300, after: 0 }], 'black')).toBe(0);
    });
  });

  describe('gameAccuracy (AccuracyPercent.gameAccuracy)', () => {
    it('retourne 0/0 sans coup analysé', () => {
      expect(gameAccuracy([], 'white')).toEqual({ white: 0, black: 0 });
    });

    it('récompense une partie stable (peu de volatilité)', () => {
      const stable = gameAccuracy(Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 20 : 15)), 'white');
      expect(stable.white).toBeGreaterThan(90);
      expect(stable.white).toBeLessThanOrEqual(100);
    });

    it('pénalise une partie où un camp perd à chaque coup', () => {
      const clean = gameAccuracy(Array.from({ length: 30 }, () => 10), 'white');
      // Évaluation qui se dégrade régulièrement : le camp au trait aux plies
      // pairs (Blanc si startColor = white) perd à chaque coup.
      const sloppy = gameAccuracy(
        Array.from({ length: 30 }, (_, i) => 500 - i * 45),
        'white'
      );
      expect(sloppy.white).toBeLessThan(clean.white);
      // Le camp qui ne perd rien garde une précision élevée.
      expect(sloppy.black).toBeGreaterThan(sloppy.white);
    });

    it('gère les évaluations manquantes sans planter', () => {
      const result = gameAccuracy([0, undefined, 100, undefined, 50], 'white');
      expect(Number.isFinite(result.white)).toBe(true);
      expect(Number.isFinite(result.black)).toBe(true);
    });

    it('distingue les coups par couleur (pas de score identique)', () => {
      const cps = Array.from({ length: 20 }, (_, i) => 400 - i * 40);
      const result = gameAccuracy(cps, 'white');
      expect(result.white).not.toBeCloseTo(result.black, 6);
    });

    it('reste borné dans [0, 100]', () => {
      const r = gameAccuracy(Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? 800 : -400)), 'black');
      for (const v of [r.white, r.black]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    });

    it('retourne 100 % sur une partie parfaitement stable (écart-type nul dans chaque fenêtre → poids 0.5)', () => {
      const perfect = gameAccuracy(Array.from({ length: 24 }, () => INITIAL_CP), 'white');
      expect(perfect.white).toBeCloseTo(100, 5);
      expect(perfect.black).toBeCloseTo(100, 5);
    });

    it('calcule les précisions par phase (ouverture, milieu, finale) via phaseAccuracies', () => {
      const fens = [
        // Ouverture (toutes les pièces)
        'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
        'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
        // Milieu de jeu (≤ 10 pièces majeures/mineures, mais > 6)
        'r2q1rk1/ppp2ppp/2n5/8/8/2N5/PPP2PPP/R2Q1RK1 w - - 0 10',
        'r2q1rk1/ppp2ppp/2n5/8/8/2N5/PPP2PPP/R2Q1RK1 b - - 0 10',
        'r2q1rk1/ppp2ppp/2n5/8/8/2N5/PPP2PPP/R2Q1RK1 w - - 0 11',
        'r2q1rk1/ppp2ppp/2n5/8/8/2N5/PPP2PPP/R2Q1RK1 b - - 0 11',
        // Finale (≤ 6 pièces majeures/mineures)
        '4k3/ppp2ppp/8/8/8/8/PPP2PPP/4K3 w - - 0 20',
        '4k3/ppp2ppp/8/8/8/8/PPP2PPP/4K3 b - - 0 20',
        '4k3/ppp2ppp/8/8/8/8/PPP2PPP/4K3 w - - 0 21',
        '4k3/ppp2ppp/8/8/8/8/PPP2PPP/4K3 b - - 0 21',
      ];
      const cps = fens.map(() => 15);
      const phases = phaseAccuracies(cps, fens, 'white');
      expect(phases.division.middle).toBe(4);
      expect(phases.division.end).toBe(8);
      expect(phases.opening?.white).toBeCloseTo(100, 1);
      expect(phases.middlegame?.white).toBeCloseTo(100, 1);
      expect(phases.endgame?.white).toBeCloseTo(100, 1);
    });
  });
});
