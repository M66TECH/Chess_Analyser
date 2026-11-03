export type EngineEvaluation = {
  depth: number;
  cp?: number;
  mate?: number;
  pv: string[];
};

export type HeatmapData = {
  [square: string]: {
    whiteInfluence: number;
    blackInfluence: number;
  };
};

export type GameEvents = {
  MovePlayed: { fen: string; move: string };
  PositionChanged: { fen: string };
  EngineEvaluationUpdated: EngineEvaluation;
  BestMoveChanged: { move: string };
  HeatmapUpdated: HeatmapData;
  AnalysisStarted: void;
  AnalysisFinished: void;
};

type EventHandler<T> = (data: T) => void;

export class GameEventBus {
  private listeners: Map<keyof GameEvents, Function[]> = new Map();

  public on<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  public off<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>) {
    if (!this.listeners.has(event)) return;
    const filtered = this.listeners.get(event)!.filter(h => h !== handler);
    this.listeners.set(event, filtered);
  }

  public emit<K extends keyof GameEvents>(event: K, data: GameEvents[K]) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event)!.forEach(handler => handler(data));
  }
}
