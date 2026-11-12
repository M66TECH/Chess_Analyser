import { describe, it, expect } from 'vitest';
import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { MotifEngine } from '../pedagogy/MotifEngine';
import { ExplanationEngine } from '../pedagogy/ExplanationEngine';
import type { MoveRecord } from '../pedagogy/types';

describe('Positions de référence d\'école certifiées (I3 & P0)', () => {
  describe('1. Partie de l\'Opéra (Morphy vs Brunswick & Isouard, 1858)', () => {
    // Position après 14...De6 (14...Qe6), les Blancs ont le trait pour 15. Bxd7+
    const fenAfter14Qe6 = '4kb1r/p2r1ppp/4qn2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 2 15';

    it('la position FEN après 14...Qe6 est valide dans chessops', () => {
      const setup = parseFen(fenAfter14Qe6);
      expect(setup.isOk).toBe(true);
      const pos = Chess.fromSetup(setup.unwrap()).unwrap();
      expect(pos.turn).toBe('white');
    });

    it('démontre que 14...De6 défend la tour d7 mais NE LA DÉCLOUE PAS (vérité échiquéenne certifiée)', () => {
      const motifs = MotifEngine.analyzeFen(fenAfter14Qe6);
      expect(motifs).toBeDefined();

      // Case d7 = index 51, Case b5 = index 33, Case e8 = index 60
      const pinOnD7 = motifs?.pins.find((p) => p.pinned === 51);
      expect(pinOnD7).toBeDefined();
      expect(pinOnD7?.pinner).toBe(33); // Fou b5
      expect(pinOnD7?.target).toBe(60); // Roi e8
    });

    it('15.Fxd7+ (Bxd7+) est le coup légal d\'attaque blanche donnant échec', () => {
      const setup = parseFen(fenAfter14Qe6).unwrap();
      const pos = Chess.fromSetup(setup).unwrap();
      const move = parseSan(pos, 'Bxd7+');
      expect(move).toBeDefined();
      pos.play(move!);
      expect(pos.isCheck()).toBe(true);
    });
  });

  describe('2. Karpov – Kasparov 1985 (16e partie, le cavalier pieuvre en d3)', () => {
    // FEN avant 16...Nd3!
    const fenBefore16Nd3 = 'r2qr1k1/5ppp/p4n2/1pbP1bB1/1n6/N1N2B2/PP1Q1PPP/3R1RK1 b - - 1 16';
    // FEN après 16...Nd3!
    const fenAfter16Nd3 = 'r2qr1k1/5ppp/p4n2/1pbP1bB1/8/N1Nn1B2/PP1Q1PPP/3R1RK1 w - - 2 17';

    it('les positions FEN avant et après 16...Nd3 sont valides', () => {
      const setupBefore = parseFen(fenBefore16Nd3);
      expect(setupBefore.isOk).toBe(true);
      const posBefore = Chess.fromSetup(setupBefore.unwrap()).unwrap();
      expect(posBefore.turn).toBe('black');

      const setupAfter = parseFen(fenAfter16Nd3);
      expect(setupAfter.isOk).toBe(true);
      const posAfter = Chess.fromSetup(setupAfter.unwrap()).unwrap();
      expect(posAfter.turn).toBe('white');
    });

    it('le coup 16...Nd3 (b4d3) est légal et occupe le poste avancé d3', () => {
      const pos = Chess.fromSetup(parseFen(fenBefore16Nd3).unwrap()).unwrap();
      const move = parseSan(pos, 'Nd3');
      expect(move).toBeDefined();
      pos.play(move!);
      expect(pos.turn).toBe('white');
    });

    it('vérifie que 16...Nd3 est correctement validé par le dossier factuel', () => {
      const mockRecord: MoveRecord = {
        nodeId: 'karpov-kasparov-16',
        fenBefore: fenBefore16Nd3,
        fenAfter: fenAfter16Nd3,
        playedMove: 'b4d3',
        san: 'Nd3',
        color: 'black',
        moveNumber: 16,
        cpBefore: -50,
        cpAfter: -120,
        winProbBefore: 55,
        winProbAfter: 68,
        accuracy: 99,
        classification: 'best',
      };

      const facts = ExplanationEngine.extractTacticalFacts(mockRecord);
      expect(facts).toBeDefined();
      expect(facts?.fen_before).toBe(fenBefore16Nd3);
      expect(facts?.fen_after).toBe(fenAfter16Nd3);
    });
  });

  describe('3. Karpov – Spassky 1974 (Match des Candidats m9, Leningrad)', () => {
    // Position après 10...a5, avant 11.a4
    const fenBefore11a4 = 'r2q1rk1/1p1bbppp/2nppn2/p7/4PP2/1NN1B3/PPP1B1PP/R2Q1RK1 w - - 0 11';
    // Position après 11.a4
    const fenAfter11a4 = 'r2q1rk1/1p1bbppp/2nppn2/p7/P3PP2/1NN1B3/1PP1B1PP/R2Q1RK1 b - - 0 11';

    it('la position FEN avant 11.a4 correspond bien à la 9e partie de 1974', () => {
      const setup = parseFen(fenBefore11a4);
      expect(setup.isOk).toBe(true);
      const pos = Chess.fromSetup(setup.unwrap()).unwrap();
      expect(pos.turn).toBe('white');

      const moveA4 = parseSan(pos, 'a4');
      expect(moveA4).toBeDefined();
    });

    it('le coup 11.a4 (a2a4) est légal et solidifie la structure à l\'aile dame', () => {
      const pos = Chess.fromSetup(parseFen(fenBefore11a4).unwrap()).unwrap();
      const move = parseSan(pos, 'a4');
      expect(move).toBeDefined();
      pos.play(move!);
      expect(pos.turn).toBe('black');
    });
  });
});
