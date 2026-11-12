import { describe, it, expect } from 'vitest';
import {
  serializeGame,
  parseStoredGame,
  GAME_STORE_SCHEMA_VERSION,
} from '../services/GameStore';
import type { MoveRecord } from '../pedagogy/types';

function record(overrides: Partial<MoveRecord> = {}): MoveRecord {
  return {
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    playedMove: 'e2e4',
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

describe('GameStore — persistance versionnée (P2.10)', () => {
  describe('serializeGame', () => {
    it('retourne une chaîne vide sans coups (rien à sauvegarder)', () => {
      expect(serializeGame({ moves: [], records: [] }).json).toBe('');
    });

    it('produit un payload avec le numéro de schéma', () => {
      const { json } = serializeGame({ moves: ['e2e4'], records: [record()] });
      const parsed = JSON.parse(json);
      expect(parsed.v).toBe(GAME_STORE_SCHEMA_VERSION);
      expect(parsed.moves).toEqual(['e2e4']);
      expect(parsed.ts).toBeTypeOf('number');
    });

    it('allège les records (pas de coachCard ni PV volumineuses)', () => {
      const { json } = serializeGame({
        moves: ['e2e4'],
        records: [
          record({
            coachCard: { headline: 'X', insights: [], takeaway: 'Y', level: 'debutant' },
            bestPv: ['e2e4', 'e7e5', 'g1f3'],
            explanation: 'long texte',
          }),
        ],
      });
      const parsed = JSON.parse(json);
      expect(parsed.records[0].coachCard).toBeUndefined();
      expect(parsed.records[0].bestPv).toBeUndefined();
      expect(parsed.records[0].explanation).toBeUndefined();
      // Les données utiles à l'affichage sont conservées.
      expect(parsed.records[0].san).toBe('e4');
      expect(parsed.records[0].classification).toBe('best');
    });

    it('conserve initialFen pour un PGN personnalisé', () => {
      const fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
      const { json } = serializeGame({ moves: ['e1d2'], records: [], initialFen: fen });
      expect(JSON.parse(json).initialFen).toBe(fen);
    });
  });

  describe('parseStoredGame', () => {
    it('relit une sauvegarde v1 valide', () => {
      const { json } = serializeGame({ moves: ['e2e4', 'e7e5'], records: [record()] });
      const result = parseStoredGame(json);
      expect(result.ok).toBe(true);
      expect(result.game?.moves).toEqual(['e2e4', 'e7e5']);
      expect(result.game?.records).toHaveLength(1);
    });

    it('rejette un JSON invalide avec un message clair', () => {
      const result = parseStoredGame('{pas du json');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('illisibles');
    });

    it('rejette une version de schéma inconnue (jamais de chargement partiel)', () => {
      const future = JSON.stringify({ v: 99, moves: ['e2e4'], records: [] });
      const result = parseStoredGame(future);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('99');
      expect(result.game).toBeUndefined();
    });

    it('rejette une sauvegarde sans coups', () => {
      const result = parseStoredGame(JSON.stringify({ v: 1, moves: [] }));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('sans coups');
    });

    it('rejette un tableau JSON ou un null', () => {
      expect(parseStoredGame('[]').ok).toBe(false);
      expect(parseStoredGame('null').ok).toBe(false);
      expect(parseStoredGame('"texte"').ok).toBe(false);
    });

    it('accepte l\'ancien format (sans v) mais ignore ses records', () => {
      const legacy = JSON.stringify({
        moves: ['e2e4'],
        initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        records: [{ nodeId: 'n1', forme_obsolete: true }],
        ts: 123,
      });
      const result = parseStoredGame(legacy);
      expect(result.ok).toBe(true);
      expect(result.game?.moves).toEqual(['e2e4']);
      // Records de format inconnu ignorés : la partie est rejouée/réanalysée.
      expect(result.game?.records).toBeUndefined();
    });
  });

  describe('aller-retour', () => {
    it('sérialise puis relit sans perte des données utiles', () => {
      const records = [
        record(),
        record({ san: 'e5', playedMove: 'e7e5', color: 'black', nodeId: 'n2', classification: 'book' }),
      ];
      const { json } = serializeGame({ moves: ['e2e4', 'e7e5'], records });
      const result = parseStoredGame(json);
      expect(result.ok).toBe(true);
      expect(result.game?.records?.map(r => r.san)).toEqual(['e4', 'e5']);
      expect(result.game?.records?.map(r => r.classification)).toEqual(['best', 'book']);
    });

    it('préserve bestMove, mateBefore et mateSequence lors de la sérialisation', () => {
      const records = [
        record({
          bestMove: 'd2d4',
          mateBefore: 3,
          mateAfter: 2,
          mateSequence: 'created',
        }),
      ];
      const { json } = serializeGame({ moves: ['e2e4'], records });
      const result = parseStoredGame(json);
      expect(result.ok).toBe(true);
      expect(result.game?.records?.[0].bestMove).toBe('d2d4');
      expect(result.game?.records?.[0].mateBefore).toBe(3);
      expect(result.game?.records?.[0].mateSequence).toBe('created');
    });
  });
});
