import { GameEventBus } from '../events/GameEventBus';
import { EngineParser } from './EngineParser';

export class EngineManager {
  private worker: Worker | null = null;
  private isReady = false;

  constructor(
    private eventBus: GameEventBus,
    private wasmPath: string = '/stockfish/stockfish.js'
  ) {}

  public init() {
    if (typeof window !== 'undefined' && !this.worker) {
      this.worker = new Worker(this.wasmPath);
      this.worker.onmessage = this.handleMessage.bind(this);
      this.worker.postMessage('uci');
    }
  }

  private handleMessage(event: MessageEvent) {
    const msg = event.data;
    if (msg === 'uciok') {
      this.isReady = true;
      this.worker?.postMessage('isready');
    }
    
    const evaluation = EngineParser.parseUciInfo(msg);
    if (evaluation) {
      this.eventBus.emit('EngineEvaluationUpdated', evaluation);
      if (evaluation.pv.length > 0) {
        this.eventBus.emit('BestMoveChanged', { move: evaluation.pv[0] });
      }
    }
  }

  public analyze(fen: string, depth: number = 15) {
    if (!this.isReady || !this.worker) return;
    this.worker.postMessage('stop');
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${depth}`);
    this.eventBus.emit('AnalysisStarted', undefined);
  }

  public stop() {
    this.worker?.postMessage('stop');
    this.eventBus.emit('AnalysisFinished', undefined);
  }

  public terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.isReady = false;
  }
}
