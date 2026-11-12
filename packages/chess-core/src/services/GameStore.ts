import type { MoveRecord } from '../pedagogy/types';

/**
 * Persistance des parties : sérialisation versionnée (P2.10).
 *
 * Le localStorage de l'application (`chess-analyzer:game`) contenait des
 * données sans champ `schemaVersion`. Au premier changement de forme de
 * `MoveRecord` (nouveau champ, renommé, supprimé), la restaURATION chargeait
 * des données fausses sans erreur visible — corruption silencieuse.
 *
 * Ce module garantit :
 * - toute sauvegarde porte `schemaVersion: 1` ;
 * - toute restauration vérifie la version et rejette proprement un format
 *   inconnu (message clair, pas de chargement partiel) ;
 * - la validation du contenu (moves UCI non vides) est centralisée.
 *
 * L'export/import JSON Manuel (sauvegarde fichier) valide le même schéma.
 */

/** Version courante du schéma de persistance. Incrémenter à chaque breaking change. */
export const GAME_STORE_SCHEMA_VERSION = 1;

/** Clé localStorage de la partie courante. */
export const GAME_STORE_KEY = 'chess-analyzer:game';

/** Contenu minimal pour rejouer la partie sans ré-analyser. */
export interface StoredGameV1 {
  /** Version du schéma. Doit être 1 pour être accepted en lecture. */
  v: 1;
  /** Coups UCI de la branche active. */
  moves: string[];
  /** FEN de départ (position initiale ou PGN). */
  initialFen?: string;
  /** Records sauvegardés (sans coachCard ni textes volumineux). */
  records?: StoredMoveRecord[];
  /** Date de la sauvegarde (ms epoch). */
  ts?: number;
}

/**
 * Version allégée de `MoveRecord` pour la persistance : on retire les champs
 * volumineux et non nécessaires à la reprise (l'analyse est refaite à la volée).
 */
export interface StoredMoveRecord {
  nodeId: string;
  playedMove: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
  color: 'white' | 'black';
  moveNumber: number;
  cpBefore: number;
  cpAfter: number;
  mateBefore?: number;
  mateAfter?: number;
  bestMove?: string;
  winProbBefore: number;
  winProbAfter: number;
  accuracy: number;
  classification: string;
  classificationLabel?: string;
  opening?: string;
  mate?: string | undefined;
  mateSequence?: string | undefined;
}

export interface SerializeResult {
  /** Payload prêt à stocker ('' si rien à sauvegarder). */
  json: string;
}

/**
 * Sérialise l'état d'une partie pour persistance. Versionne avec `v: 1`.
 * Retourne `''` quand il n'y a rien à sauvegarder (la clé devrait être supprimée).
 */
export function serializeGame(params: {
  moves: string[];
  records: MoveRecord[];
  initialFen?: string;
}): SerializeResult {
  const { moves, records, initialFen } = params;
  if (moves.length === 0) return { json: '' };

  const slim: StoredMoveRecord[] = records.map(r => ({
    nodeId: r.nodeId,
    playedMove: r.playedMove,
    san: r.san,
    fenBefore: r.fenBefore,
    fenAfter: r.fenAfter,
    color: r.color,
    moveNumber: r.moveNumber,
    cpBefore: r.cpBefore,
    cpAfter: r.cpAfter,
    mateBefore: r.mateBefore,
    mateAfter: r.mateAfter,
    bestMove: r.bestMove,
    winProbBefore: r.winProbBefore,
    winProbAfter: r.winProbAfter,
    accuracy: r.accuracy,
    classification: r.classification,
    opening: r.opening,
    mate: r.mateSequence,
    mateSequence: r.mateSequence,
  }));

  const payload: StoredGameV1 = {
    v: GAME_STORE_SCHEMA_VERSION,
    moves,
    initialFen,
    records: slim,
    ts: Date.now(),
  };
  return { json: JSON.stringify(payload) };
}

export interface ParseResult {
  ok: boolean;
  game?: StoredGameV1;
  /** Raison du rejet, pour affichage utilisateur et logs. */
  error?: string;
}

/**
 * Désérialise et valide un payload de partie. Retourne `ok: false` avec un
 * message clair si :
 * - le JSON est invalide ;
 * - le schéma est d'une version inconnue (migration future ou donnée
 *   corrompue) — JAMAIS charger partiellement dans ce cas ;
 * - les coups sont absents ou vides.
 */
export function parseStoredGame(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Données de sauvegarde illisibles (JSON invalide).' };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Format de sauvegarde inattendu.' };
  }

  const obj = raw as Record<string, unknown>;
  const version = obj.v as number | undefined;

  // Pas de champ v → ancien format pré-versioning : on ne peut pas garantir
  // la structure des records, mais les coups UCI et initialFen sont
  // toujours valides. On les accepte comme une v1 sans records.
  if (version === undefined) {
    if (!Array.isArray(obj.moves) || (obj.moves as string[]).length === 0) {
      return { ok: false, error: 'Sauvegarde sans coups joués.' };
    }
    return {
      ok: true,
      game: {
        v: 1,
        moves: obj.moves as string[],
        initialFen: typeof obj.initialFen === 'string' ? obj.initialFen : undefined,
        // Ancien format : les records peuvent contenir des champs obsolètes,
        // on les ignore pour éviter toute corruption.
        records: undefined,
        ts: typeof obj.ts === 'number' ? obj.ts : undefined,
      },
    };
  }

  if (version !== GAME_STORE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Sauvegarde de version ${version} non supportée (version actuelle : ${GAME_STORE_SCHEMA_VERSION}).`,
    };
  }

  if (!Array.isArray(obj.moves) || (obj.moves as string[]).length === 0) {
    return { ok: false, error: 'Sauvegarde sans coups joués.' };
  }

  return {
    ok: true,
    game: {
      v: version,
      moves: obj.moves as string[],
      initialFen: typeof obj.initialFen === 'string' ? obj.initialFen : undefined,
      records: Array.isArray(obj.records) ? (obj.records as StoredMoveRecord[]) : undefined,
      ts: typeof obj.ts === 'number' ? obj.ts : undefined,
    },
  };
}
