/**
 * Lecture des lignes UCI Stockfish, portée depuis `lila/ui/lib/src/ceval/protocol.ts`.
 *
 * Différences volontairement assumées avec Lichess :
 * - nous n'utilisons qu'une seule ligne (`MultiPV = 1`) : l'IA explique la
 *   meilleure proposition, pas un comparatif de variantes ;
 * - le score est renvoyé tel que Stockfish l'émet (point de vue du camp au
 *   trait), la conversion est faite par `LichessAccuracy.povChances`.
 */

export interface UciInfo {
  depth: number;
  nodes?: number;
  /** Centipions, point de vue du camp au trait. */
  cp?: number;
  /** Mat en N coups, point de vue du camp au trait. */
  mate?: number;
  /** Nombre de demi-coups de la ligne principale. */
  multipv: number;
  pv: string[];
  /** `true` pour un score « au moins » / « au plus » (non exact). */
  bound?: 'lower' | 'upper';
}

export interface UciBestMove {
  bestMove: string;
  ponder?: string;
}

/**
 * Parse une ligne `info depth … score cp … pv …`.
 * Retourne `null` pour les lignes inexploitables (pas de score, `#0`, etc.).
 */
export const parseUciInfo = (line: string): UciInfo | null => {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== 'info') return null;

  let depth = 0;
  let nodes: number | undefined;
  let multipv = 1;
  let isMate = false;
  let povEv: number | undefined;
  let bound: 'lower' | 'upper' | undefined;
  let pv: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    switch (parts[i]) {
      case 'depth':
        depth = parseInt(parts[++i], 10);
        break;
      case 'nodes':
        nodes = parseInt(parts[++i], 10);
        break;
      case 'multipv':
        multipv = parseInt(parts[++i], 10);
        break;
      case 'score':
        isMate = parts[++i] === 'mate';
        povEv = parseInt(parts[++i], 10);
        if (parts[i + 1] === 'lowerbound' || parts[i + 1] === 'upperbound') {
          bound = parts[++i] === 'lowerbound' ? 'lower' : 'upper';
        }
        break;
      case 'pv':
        pv = parts.slice(++i);
        i = parts.length;
        break;
      default:
        break;
    }
  }

  // Stockfish émet parfois « mate 0 » : ce n'est pas une information utilisable.
  if (isMate && !povEv) return null;
  if (!Number.isFinite(depth) || povEv === undefined || Number.isNaN(povEv)) return null;

  return {
    depth,
    nodes: Number.isFinite(nodes) ? nodes : undefined,
    cp: isMate ? undefined : povEv,
    mate: isMate ? povEv : undefined,
    multipv: Number.isFinite(multipv) ? multipv : 1,
    pv,
    bound,
  };
};

/** Parse la ligne `bestmove e2e4 ponder e7e5`. */
export const parseBestMove = (line: string): UciBestMove | null => {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== 'bestmove' || parts.length < 2) return null;
  // `bestmove (none)` : aucune position légale, rien à jouer.
  if (parts[1] === '(none)') return null;
  return {
    bestMove: parts[1],
    ponder: parts[2] === 'ponder' ? parts[3] : undefined,
  };
};

/**
 * Commandes d'initialisation envoyées après `uciok`.
 *
 * Lichess envoie aussi `UCI_Chess960 value true` avec le commentaire « affects
 * notation only ». **On ne le fait pas** : sous Chess960, Stockfish encode le
 * roque en UCI comme `e1h1` au lieu de `e1g1`, ce qui casserait nos conversions
 * UCI↔SAN et la détection du « meilleur coup » (comparaison de chaînes).
 * On garde uniquement les options qui ne modifient pas les coups émis.
 */
export const UCI_INIT_COMMANDS = [
  'setoption name UCI_AnalyseMode value true',
  'setoption name Analysis Contempt value Off',
] as const;

/**
 * Options de moteur.
 *
 * `multiPv` est volontairement à **1** : c'est ce que fait Lichess par défaut
 * (`protocol.ts`, préférence utilisateur à 1), et chaque ligne MultiPV
 * supplémentaire coûte ~1× le temps de recherche. Les flèches alternatives
 * (`evalState`/`multiPvs`) restent disponibles : `showMultiPv()` permet de
 * monter à 3 à la demande.
 */
export const UCI_ENGINE_OPTIONS = {
  threads: 2,
  hash: 32,
  multiPv: 1,
} as const;

/** Nombre de lignes demandées quand l'utilisateur veut voir les alternatives. */
export const UCI_MULTIPV_WITH_LINES = 3;
