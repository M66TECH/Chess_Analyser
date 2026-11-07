/**
 * Validation des entrées des routes API.
 *
 * Un FEN standard fait moins de 100 octets ; les paramètres venant du client
 * ne doivent pas pouvoir relayer des charges arbitraires vers Lichess ou vers
 * le fournisseur LLM (amplification, coût, mémoire serveur).
 */

/** Longueur maximale plausible d'un FEN (avec marge pour positions étendues). */
export const MAX_FEN_LENGTH = 200;

/** Taille maximale d'un corps JSON accepté par /api/coach (octets). */
export const MAX_COACH_BODY_BYTES = 64 * 1024;

export interface FenValidation {
  ok: boolean;
  /** FEN nettoyé (trim), à réutiliser si ok. */
  fen?: string;
  error?: string;
}

/**
 * Valide un FEN reçu en query string.
 * Contrôles : présence, longueur bornée, jeu de caractères attendu,
 * nombre de champs suffisant (placement + trait + roque + ep + compteurs).
 */
export function validateFen(raw: string | null): FenValidation {
  if (!raw) return { ok: false, error: 'FEN is required' };

  const fen = raw.trim();
  if (fen.length === 0) return { ok: false, error: 'FEN is required' };
  if (fen.length > MAX_FEN_LENGTH) {
    return { ok: false, error: `FEN too long (max ${MAX_FEN_LENGTH} chars)` };
  }
  // Un FEN ne contient que ces caractères (pièces, chiffres, séparateurs).
  if (!/^[prnbqkPRNBQK1-8/]+ [wb] [-kqKQ]+ (?:[a-h][1-8]|-) \d+ \d+$/.test(fen)) {
    return { ok: false, error: 'Malformed FEN' };
  }

  return { ok: true, fen };
}

/**
 * Valide `multiPv` : entier borné [1, 5] (lila plafonne à 5 côté client, et
 * au-delà le coût Stockfish croît sans bénéfice pédagogique).
 */
export function validateMultiPv(raw: string | null, fallback = 3): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(5, parsed);
}

/**
 * Valide le nombre de coups demandés à l'explorateur : entier borné [1, 50]
 * (l'API Lichess accepte plus, mais l'UI n'en affiche que 10-12).
 */
export function validateMoveCount(raw: string | null, fallback = 12): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(50, parsed);
}
