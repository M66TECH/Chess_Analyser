import { GameEventBus, EngineEvaluation } from '../events/GameEventBus';
import {
  parseBestMove,
  parseUciInfo,
  UCI_ENGINE_OPTIONS,
  UCI_INIT_COMMANDS,
} from './LichessUci';
import {
  getRecommendedEngineConfig,
  type EngineConfig,
} from './EngineCapability';

/** Profondeur cible de référence pour valider une analyse et générer la pédagogie. */
export const DEFAULT_TARGET_DEPTH = 18;

/** Plafond de confort pour l'analyse continue en direct sur l'échiquier. */
export const MAX_CONTINUOUS_DEPTH = 32;

/**
 * Pilote Stockfish (WASM Worker) avec le protocole UCI de Lichess
 * (`lila/ui/lib/src/ceval/protocol.ts`).
 *
 * Sélection adaptative :
 * - Stockfish 19 avec Relaxed SIMD si supporté par le navigateur
 * - Stockfish 19 SmallNet standard
 * - Repli automatique sur Stockfish 10 si environnement ancien ou restreint.
 *
 * Conventions :
 * - `EngineEvaluation.cp` / `.mate` sont toujours exprimés **du point de vue du
 *   camp au trait** dans la position analysée (convention UCI). Le pipeline les
 *   ramène en POV Blanc via `EvalNormalizer.normalize(cp, mate, sideToMove)`.
 * - Chaque évaluation est étiquetée avec `fen` : le pipeline peut ainsi jeter
 *   les réponses obsolètes (navigation rapide, nouveau coup pendant l'analyse).
 */
export class EngineManager {
  private worker: Worker | null = null;
  private isReady = false;
  private config: EngineConfig;

  /** Analyse demandée avant que le moteur soit prêt (une seule, la dernière). */
  private pendingFen: string | null = null;
  private pendingDepth = DEFAULT_TARGET_DEPTH;

  private isThreatMode = false;
  private currentAnalysisFen: string | null = null;

  /** MultiPV actuellement configuré dans le moteur (voir `setMultiPv`). */
  private currentMultiPv: number = UCI_ENGINE_OPTIONS.multiPv;

  /**
   * Mode demandé pendant que le moteur chargeait. Sans lui, un utilisateur qui
   * active les menaces avant `readyok` recevrait une analyse normale : au
   * `readyok`, `handleReadyOk` relancerait via `analyze()` qui écrase le flag.
   */
  private pendingThreat = false;

  /** Historique associé à l'analyse mise en file avant `readyok`. */
  private pendingHistory: { rootFen: string; moves: string[] } | null = null;

  /**
   * Recherche réellement en cours (un `go` a été envoyé, `bestmove` pas encore
   * reçu). Sert de barrière `stop` → `isready` → `go` (cf. `startSearch`).
   */
  private searchInFlight = false;

  /** Analyse demandée pendant qu'une recherche tourne ; envoyée après `readyok`. */
  private pendingGo: {
    fen: string;
    depth: number;
    history?: { rootFen: string; moves: string[] };
    startedEvent: 'AnalysisStarted' | 'ThreatAnalysisStarted';
  } | null = null;

  constructor(
    private eventBus: GameEventBus,
    private wasmPath?: string
  ) {
    this.config = getRecommendedEngineConfig();
    if (this.wasmPath) {
      this.config.workerPath = this.wasmPath;
    }
  }

  public getConfig(): EngineConfig {
    return this.config;
  }

  // ---------------------------------------------------------------- lifecycle

  public init() {
    if (typeof window === 'undefined' || this.worker) return;

    try {
      this.createWorker(this.config.workerPath, this.config.isModule && !this.wasmPath);
    } catch (err: unknown) {
      // Si le profil moderne échoue, tenter un repli vers Stockfish 10
      if (this.config.profile !== 'sf10-legacy') {
        try {
          console.warn('[EngineManager] Tentative de repli vers le profil hérité suite à:', err);
          this.config = {
            profile: 'sf10-legacy',
            workerPath: '/stockfish/stockfish.js',
            isModule: false,
            simd: false,
            concurrency: 1,
            engineName: 'Stockfish 10 (Repli)',
          };
          this.createWorker(this.config.workerPath, false);
          return;
        } catch {
          // Repli échoué, suite normale
        }
      }
      const msg = err instanceof Error ? err.message : 'Impossible de créer le Worker Stockfish';
      console.error('[EngineManager] Init error:', msg);
      this.eventBus.emit('EngineError', msg);
    }
  }

  private createWorker(path: string, isModule: boolean) {
    const options: WorkerOptions | undefined = isModule ? { type: 'module' } : undefined;
    this.worker = new Worker(path, options);
    this.worker.onmessage = this.handleMessage.bind(this);

    this.worker.onerror = (e: ErrorEvent) => {
      const msg = e.message || 'Erreur inconnue du Worker Stockfish';
      console.error('[EngineManager] Worker error:', msg);
      this.eventBus.emit('EngineError', msg);
    };

    this.worker.onmessageerror = () => {
      const msg = 'Erreur de décodage de message Stockfish';
      console.error('[EngineManager]', msg);
      this.eventBus.emit('EngineError', msg);
    };

    this.send('uci');
  }

  public terminate() {
    if (!this.worker) return;
    try {
      this.worker.postMessage('stop');
    } catch {
      // Le worker peut déjà être mort : on continue le nettoyage.
    }
    this.worker.terminate();
    this.worker = null;
    this.isReady = false;
    this.pendingFen = null;
    this.pendingHistory = null;
    this.pendingGo = null;
    this.searchInFlight = false;
    this.currentAnalysisFen = null;
  }

  /** `stop` sans émettre `AnalysisFinished` : le worker répondra lui-même `bestmove`. */
  public stop() {
    this.pendingGo = null;
    this.pendingFen = null;
    if (!this.worker) return;
    this.send('stop');
  }

  /** Nouvelle partie : on vide la table de transposition. */
  public reinit() {
    if (!this.isReady) return;
    this.pendingGo = null;
    this.send('stop');
    this.send('ucinewgame');
  }

  /**
   * Monte le MultiPV à `lines` (1 par défaut = le plus rapide).
   * `MultiPV > 1` multiplie le coût de recherche : on ne l'active que si
   * l'utilisateur veut voir les lignes alternatives.
   */
  public setMultiPv(lines: number) {
    const clamped = Math.min(5, Math.max(1, Math.trunc(lines)));
    if (clamped === this.currentMultiPv) return;
    this.currentMultiPv = clamped;
    this.send(`setoption name MultiPV value ${clamped}`);
  }

  /** Lignes MultiPV actuellement configurées. */
  public get multiPv(): number {
    return this.currentMultiPv;
  }

  // ---------------------------------------------------------------- messages

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private handleMessage(event: MessageEvent) {
    const msg = typeof event.data === 'string' ? event.data : '';
    if (!msg) return;

    const parts = msg.trim().split(/\s+/);

    if (parts[0] === 'uciok') {
      this.handleUciOk();
      return;
    }

    if (parts[0] === 'readyok') {
      this.handleReadyOk();
      return;
    }

    if (parts[0] === 'bestmove') {
      this.handleBestMove(msg);
      return;
    }

    if (parts[0] === 'info') {
      this.handleInfo(msg);
    }
  }

  /**
   * Options d'analyse alignées sur Lichess (`protocol.ts` → `received('uciok')`).
   *
   * Note sur `UCI_Chess960` : Lichess l'active « pour la notation uniquement ».
   * Ici, il changerait l'encodage du roque en UCI (`e1h1` au lieu de `e1g1`),
   * ce qui casserait nos conversions UCI↔SAN. On garde donc le roque standard
   * et on conserve uniquement les options qui n'altèrent pas les coups émis.
   */
  private handleUciOk() {
    // Analyse sans contempt : on veut l'évaluation objective, pas un bonus
    // artificiel pour le camp au trait. Commandes partagées avec Lichess
    // (`UCI_INIT_COMMANDS`, cf. protocol.ts).
    for (const command of UCI_INIT_COMMANDS) {
      this.send(command);
    }

    const threads = Math.max(1, this.config.concurrency || UCI_ENGINE_OPTIONS.threads);
    this.send(`setoption name Threads value ${threads}`);
    this.send(`setoption name Hash value ${UCI_ENGINE_OPTIONS.hash}`);
    this.send(`setoption name MultiPV value ${this.currentMultiPv}`);

    this.send('isready');
  }

  private handleReadyOk() {
    this.isReady = true;

    // Priorité 1 : une analyse attendait la fin de la précédente (barrière).
    if (this.pendingGo) {
      this.searchInFlight = false;
      this.flushPendingGo();
      return;
    }

    const fen = this.pendingFen;
    if (fen === null) return;

    const depth = this.pendingDepth;
    const asThreat = this.pendingThreat;
    const history = this.pendingHistory;
    this.pendingFen = null;
    this.pendingThreat = false;
    this.pendingHistory = null;

    if (asThreat) {
      this.analyzeThreat(fen, depth);
    } else {
      this.analyze(fen, depth, history ?? undefined);
    }
  }

  private handleBestMove(msg: string) {
    // La recherche en cours est terminée : la barrière peut laisser passer
    // l'analyse suivante.
    this.searchInFlight = false;

    const best = parseBestMove(msg);
    if (best) {
      this.eventBus.emit('BestMoveChanged', { move: best.bestMove });
    }
    // Le moteur a fini : le pipeline peut conclure même si la profondeur cible
    // n'a pas été atteinte (mat trouvé, moteur arrêté, profondeur maximale).
    this.eventBus.emit('AnalysisFinished', undefined as never);

    // Une analyse a été demandée pendant celle-ci : on l'enchaîne proprement.
    if (this.pendingGo) this.flushPendingGo();
  }

  private handleInfo(msg: string) {
    const info = parseUciInfo(msg);
    if (!info) return;

    // Lichess ignore les bornes pour la PV principale uniquement : les PV
    // secondaires n'ont souvent qu'une borne supérieure.
    if (info.bound && info.multipv === 1) return;

    // Le FEN demandé est posé avant l'envoi de `go`, donc toute réponse reçue
    // ici appartient à la position courante ou à une précédente (étiquetée).
    const evaluation: EngineEvaluation = {
      depth: info.depth,
      pv: info.pv,
      multiPv: info.multipv,
      fen: this.currentAnalysisFen ?? undefined,
      source: 'local',
      nodes: info.nodes,
    };
    if (typeof info.cp === 'number') evaluation.cp = info.cp;
    if (typeof info.mate === 'number') evaluation.mate = info.mate;

    if (this.isThreatMode) {
      this.eventBus.emit('ThreatEvaluationUpdated', evaluation);
    } else {
      this.eventBus.emit('EngineEvaluationUpdated', evaluation);
    }
  }

  // ---------------------------------------------------------------- analysis

  /**
   * Analyse `fen` à `depth`.
   * Si `history` est fourni (FEN du dernier coup irréversible + liste UCI),
   * Stockfish reçoit `position fen <rootFen> moves ...` pour détecter les
   * répétitions de position (`ceval/ctrl.ts` de Lichess), tout en étiquetant
   * les évaluations avec `fen`.
   *
   * Fiabilité : `stop` est **suivi d'un `isready`**, et `go` n'est envoyé
   * qu'après `readyok`. Sans cette barrière, Stockfish peut ignorer le `go`
   * qui suit immédiatement un `stop` (la recherche précédente n'a pas encore
   * rendu la main) — c'est exactement ce que fait `swapWork()` chez lila.
   */
  public analyze(
    fen: string,
    depth = DEFAULT_TARGET_DEPTH,
    history?: { rootFen: string; moves: string[] },
    continuous = false
  ) {
    this.isThreatMode = false;
    this.pendingThreat = false;

    const targetDepth = continuous ? Math.max(depth, MAX_CONTINUOUS_DEPTH) : depth;

    if (!this.isReady || !this.worker) {
      this.pendingFen = fen;
      this.pendingDepth = targetDepth;
      this.pendingHistory = history ?? null;
      // Étiquette posée dès maintenant : une réponse tardive pour cette
      // position restera correctement attribuée.
      this.currentAnalysisFen = fen;
      return;
    }

    this.startSearch(fen, targetDepth, history, 'AnalysisStarted');
  }

  /**
   * Envoie la séquence `stop` → `isready` (barrière) → `position` → `go`.
   * `readyok` déclenche la suite via `pendingGo`.
   */
  private startSearch(
    fen: string,
    depth: number,
    history: { rootFen: string; moves: string[] } | undefined,
    startedEvent: 'AnalysisStarted' | 'ThreatAnalysisStarted'
  ) {
    this.currentAnalysisFen = fen;
    this.pendingGo = { fen, depth, history, startedEvent };

    if (this.searchInFlight) {
      // Une recherche tourne : on l'arrête et on attend `readyok` avant `go`.
      this.send('stop');
      this.send('isready');
      return;
    }

    // Rien en cours : on peut enchaîner directement.
    this.flushPendingGo();
  }

  /** Envoie réellement `position` + `go` pour la demande en attente. */
  private flushPendingGo() {
    const job = this.pendingGo;
    if (!job || !this.worker) return;
    this.pendingGo = null;

    // Le mode doit être appliqué AU MOMENT de l'envoi : entre la demande et la
    // barrière `readyok`, un autre appel a pu changer `isThreatMode`.
    this.isThreatMode = job.startedEvent === 'ThreatAnalysisStarted';
    this.currentAnalysisFen = job.fen;

    if (job.history && job.history.moves.length > 0) {
      this.send(`position fen ${job.history.rootFen} moves ${job.history.moves.join(' ')}`);
    } else {
      this.send(`position fen ${job.fen}`);
    }
    this.send(`go depth ${job.depth}`);
    this.searchInFlight = true;
    this.eventBus.emit(job.startedEvent, undefined as never);
  }

  /**
   * Analyse la position vue du camp adverse (mode « menaces »).
   * Le trait est inversé et l'en passant effacé, comme dans `src/ui/page.tsx`.
   */
  public analyzeThreat(fen: string, depth = DEFAULT_TARGET_DEPTH) {
    const parts = fen.split(' ');
    if (parts.length < 2) return;

    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    parts[3] = '-';
    const threatFen = parts.join(' ');

    this.isThreatMode = true;

    if (!this.isReady || !this.worker) {
      this.pendingFen = threatFen;
      this.pendingDepth = depth;
      this.pendingThreat = true;
      this.pendingHistory = null;
      this.currentAnalysisFen = threatFen;
      return;
    }

    this.startSearch(threatFen, depth, undefined, 'ThreatAnalysisStarted');
  }
}
