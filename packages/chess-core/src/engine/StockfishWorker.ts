export class StockfishWorker {
  private worker: Worker | null = null;
  private isReady = false;

  constructor(private wasmPath: string = '/stockfish/stockfish.js') {}

  public init() {
    if (typeof window !== 'undefined') {
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
    // TODO: Parse evaluation lines
    console.log('[Stockfish]', msg);
  }

  public analyze(fen: string, depth: number = 15) {
    if (!this.isReady || !this.worker) return;
    this.worker.postMessage('stop');
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${depth}`);
  }

  public stop() {
    this.worker?.postMessage('stop');
  }

  public terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.isReady = false;
  }
}
