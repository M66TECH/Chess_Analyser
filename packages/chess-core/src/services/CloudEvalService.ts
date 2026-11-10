import type { EngineEvaluation, EngineEvaluationSource } from '../events/GameEventBus';
import { LocalMode } from './LocalMode';

/**
 * Cloud Eval de Lichess — portage du comportement de
 * `ui/analyse/src/evalCache.ts` sur l'API REST publique
 * (`GET /api/cloud-eval?fen=…&multiPv=N`), qui remplace le couple
 * websocket `evalGet`/`evalPut` de lila.
 *
 * Sémantique conservée :
 * - cache par FEN, avec entrée `awaiting` pendant le vol (pas de requête
 *   en double) ;
 * - throttle de 700 ms partagé entre les demandes ;
 * - un hit est réémis immédiatement à la navigation (pas de refetch) ;
 * - le Stockfish local continue de tourner : le nuage ne fait que précéder
 *   l'analyse locale (lila n'arrête le local qu'en mode `movetime`).
 *
 * Différences assumées :
 * - pas d'`evalPut` : le nuage de Lichess se nourrit de ses propres clients ;
 *   notre cache local (`EvalCache`) joue le rôle de persistance côté app ;
 * - transport REST au lieu du websocket.
 *
 * ⚠ Convention de signes : les `pvs` du cloud sont en **POV Blanc** (les
 * clients lila normalisent leurs évals locales en POV Blanc avant `evalPut`).
 * Comme nos évaluations locales sont en **POV du camp au trait**, on inverse
 * à l'ingestion quand le trait est aux Noirs (`toCeval` lila n'a pas ce
 * problème car TOUT y est White-POV).
 */

export interface CloudPv {
  /** Coups UCI séparés par un espace dans la réponse brute. */
  moves: string;
  cp?: number;
  mate?: number;
}

export interface CloudEvalHit {
  fen: string;
  knodes: number;
  depth: number;
  pvs: CloudPv[];
}

const AWAITING = Symbol('awaiting');

const THROTTLE_MS = 700;
const CACHE_MAX_FENS = 4096;

export class CloudEvalService {
  private static cache: Map<string, CloudEvalHit | typeof AWAITING> = new Map();

  /** Instant du dernier envoi réel (fenêtre de throttle lila = 700 ms). */
  private static lastFetchAt = 0;
  private static sendTimer: ReturnType<typeof setTimeout> | null = null;
  /** Dernier FEN programmé : une navigation plus récente le remplace (lila : latest wins). */
  private static queued: { fen: string; multiPv: number; origin: string } | null = null;
  private static waiters = new Map<string, Array<(v: EngineEvaluation[] | null) => void>>();

  static clear() {
    this.cache.clear();
  }

  /** Nombre de FEN en cache (stats/debug). */
  static get size(): number {
    return this.cache.size;
  }

  /**
   * Récupère les MultiPV du cloud pour `fen`.
   * Retourne `null` quand la base ne connaît pas la position (404), en cas
   * d'erreur réseau, d'onglet caché — exactement comme `fetch()` de lila.
   * Chaque PV est convertie en `EngineEvaluation` (multiPv = index), scores
   * ramenés en POV du camp au trait, `source: 'cloud'`.
   */
  public static fetch(fen: string, multiPv = 3, origin = typeof window !== 'undefined' ? window.location.origin : ''): Promise<EngineEvaluation[] | null> {
    if (typeof document !== 'undefined' && document.hidden) return Promise.resolve(null);
    // P3.14 — mode local strict : le nuage est un appel réseau sortant.
    // Le cache mémoire reste consultable.
    if (!LocalMode.allowRemote('cloud-eval')) {
      const cached = this.cache.get(fen);
      return Promise.resolve(cached && cached !== AWAITING ? this.toEvaluations(cached) : null);
    }
    if (!fen) return Promise.resolve(null);

    const fetched = this.cache.get(fen);
    if (fetched !== undefined) {
      // Hit : réémis immédiatement, comme `fetch()` de lila qui renvoie
      // `toCeval(fetched)` sans refetch.
      return Promise.resolve(fetched === AWAITING ? null : this.toEvaluations(fetched));
    }

    // Dédoublonnage : si une requête pour ce FEN est déjà en attente d'envoi
    // ou en vol, les appelants s'accrochent à la même liste de waiters.
    const existing = this.waiters.get(fen);
    if (existing) {
      return new Promise(resolve => existing.push(resolve));
    }
    const waiters: Array<(v: EngineEvaluation[] | null) => void> = [];
    this.waiters.set(fen, waiters);

    // Latest wins (throttle lila) : une demande plus récente pour un AUTRE
    // fen remplace celle en file — les anciens waiters sont résolus à null
    // (jamais laissés suspendus), le FEN restera refetchable.
    if (this.queued && this.queued.fen !== fen) {
      const previousFen = this.queued.fen;
      const previousWaiters = this.waiters.get(previousFen) ?? [];
      this.waiters.delete(previousFen);
      for (const resolve of previousWaiters) resolve(null);
    }
    this.queued = { fen, multiPv, origin };

    if (this.sendTimer === null) {
      const delay = Math.max(0, this.lastFetchAt + THROTTLE_MS - Date.now());
      this.sendTimer = setTimeout(() => {
        this.sendTimer = null;
        const job = this.queued;
        this.queued = null;
        if (!job) return;
        this.lastFetchAt = Date.now();
        void this.requestNow(job.fen, job.multiPv, job.origin);
      }, delay);
    }

    return new Promise(resolve => {
      waiters.push(resolve);
    });
  }

  /**
   * Résout les appelants. Un hit est stocké **brut (POV Blanc)**, comme le
   * `fetchedByFen` de lila — la conversion POV-trait ne se fait qu'en sortie
   * (`toEvaluations`), sinon un second passage double-inverserait les Noirs.
   */
  private static settle(fen: string, hit: CloudEvalHit | null) {
    if (hit) {
      if (this.cache.size >= CACHE_MAX_FENS) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(fen, hit);
    } else {
      // 404/erreur : on retire l'`awaiting` pour permettre un refetch.
      // (lila garde `awaitingEval` à vie — divergence assumée pour
      // tolérer les échecs réseau ponctuels)
      this.cache.delete(fen);
    }

    const waiters = this.waiters.get(fen) ?? [];
    this.waiters.delete(fen);
    for (const resolve of waiters) resolve(hit ? this.toEvaluations(hit) : null);
  }

  private static async requestNow(fen: string, multiPv: number, origin: string) {
    if (typeof window === 'undefined' && !origin) {
      this.settle(fen, null);
      return;
    }
    try {
      const url = `${origin}/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (res.status === 404) {
        this.settle(fen, null);
        return;
      }
      if (!res.ok) {
        this.settle(fen, null);
        return;
      }
      const hit = (await res.json()) as CloudEvalHit;
      this.settle(fen, hit);
    } catch {
      this.settle(fen, null);
    }
  }

  /** `toCeval` de lila : moves "a b c" → tableau, cp/mate par PV. */
  private static toEvaluations(hit: CloudEvalHit): EngineEvaluation[] | null {
    if (!hit || !Array.isArray(hit.pvs) || hit.pvs.length === 0) return null;

    const turn = hit.fen.split(' ')[1] === 'b' ? 'black' : 'white';
    const sign: 1 | -1 = turn === 'white' ? 1 : -1;
    const source: EngineEvaluationSource = 'cloud';
    const nodes = Math.round((hit.knodes ?? 0) * 1000);

    const out: EngineEvaluation[] = [];
    hit.pvs.forEach((pv, index) => {
      if (!pv) return;
      const ev: EngineEvaluation = {
        depth: hit.depth,
        pv: (pv.moves ?? '').split(' ').filter(Boolean),
        multiPv: index + 1,
        fen: hit.fen,
        source,
        nodes,
      };
      // POV Blanc → POV du camp au trait.
      if (typeof pv.cp === 'number') ev.cp = pv.cp * sign;
      else if (typeof pv.mate === 'number') ev.mate = pv.mate * sign;
      out.push(ev);
    });
    return out.length > 0 ? out : null;
  }
}
