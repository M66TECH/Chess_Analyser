import { GameEventBus } from '../events/GameEventBus';
import { EngineParser } from './EngineParser';

export class EngineManager {
  private worker: Worker | null = null;
  private isReady = false;
  private pendingFen: string | null = null;
  private pendingDepth: number = 18;

  constructor(
    private eventBus: GameEventBus,
    private wasmPath: string = '/stockfish/stockfish.js'
  ) {}

  public init() {
    if (typeof window !== 'undefined' && !this.worker) {
      try {
        this.worker = new Worker(this.wasmPath);
        this.worker.onmessage = this.handleMessage.bind(this);

        // C5 — Gestion des erreurs du Worker (crash silencieux corrigé)
        this.worker.onerror = (e: ErrorEvent) => {
          const msg = e.message ?? 'Erreur inconnue du Worker Stockfish';
          console.error('[EngineManager] Worker error:', msg);
          this.eventBus.emit('EngineError', msg);
        };

        this.worker.onmessageerror = () => {
          const msg = 'Erreur de décodage de message Stockfish';
          console.error('[EngineManager]', msg);
          this.eventBus.emit('EngineError', msg);
        };

        this.worker.postMessage('uci');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Impossible de créer le Worker Stockfish';
        console.error('[EngineManager] Init error:', msg);
        this.eventBus.emit('EngineError', msg);
      }
    }
  }

  private handleMessage(event: MessageEvent) {
    const msg = typeof event.data === 'string' ? event.data : '';

    if (msg === 'uciok') {
      // E8 — Configurer les options UCI avant isready
      this.worker?.postMessage('setoption name Threads value 2');
      this.worker?.postMessage('setoption name Hash value 32');
      this.worker?.postMessage('isready');
      return;
    }

    if (msg === 'readyok') {
      this.isReady = true;
      // E8 — Envoyer ucinewgame pour initialiser la hash table proprement
      this.worker?.postMessage('ucinewgame');
      if (this.pendingFen) {
        this.analyze(this.pendingFen, this.pendingDepth);
        this.pendingFen = null;
      }
      return;
    }

    // E3 — Détecter la ligne bestmove et émettre AnalysisFinished
    if (msg.startsWith('bestmove')) {
      const bestMove = EngineParser.parseBestMove(msg);
      if (bestMove) {
        this.eventBus.emit('BestMoveChanged', { move: bestMove });
      }
      this.eventBus.emit('AnalysisFinished', undefined as never);
      return;
    }

    const evaluation = EngineParser.parseUciInfo(msg);
    if (evaluation) {
      this.eventBus.emit('EngineEvaluationUpdated', evaluation);
    }
  }

  public analyze(fen: string, depth: number = 18) {
    if (!this.isReady || !this.worker) {
      this.pendingFen = fen;
      this.pendingDepth = depth;
      return;
    }
    this.worker.postMessage('stop');
    this.worker.postMessage('setoption name MultiPV value 3');
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${depth}`);
    this.eventBus.emit('AnalysisStarted', undefined as never);
  }

  public reinit() {
    // M15 — Envoyer ucinewgame entre les parties pour nettoyer la hash table
    if (this.isReady && this.worker) {
      this.worker.postMessage('stop');
      this.worker.postMessage('ucinewgame');
    }
  }

  public stop() {
    this.worker?.postMessage('stop');
    this.eventBus.emit('AnalysisFinished', undefined as never);
  }

  public terminate() {
    this.worker?.postMessage('stop');
    this.worker?.terminate();
    this.worker = null;
    this.isReady = false;
  }
}
