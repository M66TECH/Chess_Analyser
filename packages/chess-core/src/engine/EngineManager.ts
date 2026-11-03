import { GameEventBus, EngineEvaluation } from '../events/GameEventBus';
import {
  parseBestMove,
  parseUciInfo,
  UCI_ENGINE_OPTIONS,
  UCI_INIT_COMMANDS,
} from './LichessUci';

/**
 * Pilote Stockfish (WASM Worker) avec le protocole UCI de Lichess
 * (`lila/ui/lib/src/ceval/protocol.ts`).
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

  /** Analyse demandée avant que le moteur soit prêt (une seule, la dernière). */
  private pendingFen: string | null = null;
  private pendingDepth = 18;

  private isThreatMode = false;
  private currentAnalysisFen: string | null = null;

  /**
   * Mode demandé pendant que le moteur chargeait. Sans lui, un utilisateur qui
   * active les menaces avant `readyok` recevrait une analyse normale : au
   * `readyok`, `handleReadyOk` relancerait via `analyze()` qui écrase le flag.
   */
  private pendingThreat = false;

  constructor(
    private eventBus: GameEventBus,
    private wasmPath: string = '/stockfish/stockfish.js'
  ) {}

  // ---------------------------------------------------------------- lifecycle

  public init() {
    if (typeof window === 'undefined' || this.worker) return;

    try {
      this.worker = new Worker(this.wasmPath);
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Impossible de créer le Worker Stockfish';
      console.error('[EngineManager] Init error:', msg);
      this.eventBus.emit('EngineError', msg);
    }
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
    this.currentAnalysisFen = null;
  }

  /** `stop` sans émettre `AnalysisFinished` : le worker répondra lui-même `bestmove`. */
  public stop() {
    if (!this.worker) return;
    this.send('stop');
  }

  /** Nouvelle partie : on vide la table de transposition. */
  public reinit() {
    if (!this.isReady) return;
    this.send('stop');
    this.send('ucinewgame');
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

    this.send(`setoption name Threads value ${UCI_ENGINE_OPTIONS.threads}`);
    this.send(`setoption name Hash value ${UCI_ENGINE_OPTIONS.hash}`);
    this.send(`setoption name MultiPV value ${UCI_ENGINE_OPTIONS.multiPv}`);

    this.send('isready');
  }

  private handleReadyOk() {
    this.isReady = true;
    const fen = this.pendingFen;
    if (fen === null) return;

    const depth = this.pendingDepth;
    const asThreat = this.pendingThreat;
    this.pendingFen = null;
    this.pendingThreat = false;

    if (asThreat) {
      this.analyzeThreat(fen, depth);
    } else {
      this.analyze(fen, depth);
    }
  }

  private handleBestMove(msg: string) {
    const best = parseBestMove(msg);
    if (best) {
      this.eventBus.emit('BestMoveChanged', { move: best.bestMove });
    }
    // Le moteur a fini : le pipeline peut conclure même si la profondeur cible
    // n'a pas été atteinte (mat trouvé, moteur arrêté, profondeur maximale).
    this.eventBus.emit('AnalysisFinished', undefined as never);
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
   */
  public analyze(
    fen: string,
    depth = 14,
    history?: { rootFen: string; moves: string[] }
  ) {
    this.isThreatMode = false;
    this.pendingThreat = false;

    if (!this.isReady || !this.worker) {
      this.pendingFen = fen;
      this.pendingDepth = depth;
      // Étiquette posée dès maintenant : une réponse tardive pour cette
      // position restera correctement attribuée.
      this.currentAnalysisFen = fen;
      return;
    }

    this.currentAnalysisFen = fen;
    this.send('stop');
    if (history && history.moves.length > 0) {
      this.send(`position fen ${history.rootFen} moves ${history.moves.join(' ')}`);
    } else {
      this.send(`position fen ${fen}`);
    }
    this.send(`go depth ${depth}`);
    this.eventBus.emit('AnalysisStarted', undefined as never);
  }

  /**
   * Analyse la position vue du camp adverse (mode « menaces »).
   * Le trait est inversé et l'en passant effacé, comme dans `src/ui/page.tsx`.
   */
  public analyzeThreat(fen: string, depth = 14) {
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
      this.currentAnalysisFen = threatFen;
      return;
    }

    this.currentAnalysisFen = threatFen;
    this.send('stop');
    this.send(`position fen ${threatFen}`);
    this.send(`go depth ${depth}`);
    this.eventBus.emit('ThreatAnalysisStarted', undefined as never);
  }
}
