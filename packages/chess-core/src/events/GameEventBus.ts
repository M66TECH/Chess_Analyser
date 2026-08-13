export type EngineEvaluation = {
  depth: number;
  cp?: number;
  mate?: number;
  pv: string[];
  multiPv?: number;
};

export type HeatmapData = {
  [square: string]: {
    whiteInfluence: number;
    blackInfluence: number;
  };
};

import { MoveAnalysis, MoveRecord, GameAccuracy } from '../pedagogy/types';

export type GameEvents = {
  MovePlayed: { fen: string; move: string };
  PositionChanged: { fen: string };
  EngineEvaluationUpdated: EngineEvaluation;
  BestMoveChanged: { move: string };
  HeatmapUpdated: HeatmapData;
  PedagogyUpdated: MoveAnalysis;
  MoveRecorded: MoveRecord;
  AccuracyUpdated: GameAccuracy;
  OpeningDetected: { eco: string; name: string };
  NavigateTo: { fen: string; moveIndex: number };
  AnalysisStarted: never;
  AnalysisFinished: never;
  // C5 — Erreur du moteur Stockfish Worker
  EngineError: string;
};

type EventHandler<T> = (data: T) => void;

export class GameEventBus {
  private listeners: Map<keyof GameEvents, Function[]> = new Map();

  public on<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
    return () => this.off(event, handler); // return unsubscribe function
  }

  public off<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>) {
    if (!this.listeners.has(event)) return;
    const filtered = this.listeners.get(event)!.filter(h => h !== handler);
    this.listeners.set(event, filtered);
  }

  // L3 — emit() avec try/catch pour que les erreurs d'un handler n'empêchent pas les suivants
  public emit<K extends keyof GameEvents>(event: K, data: GameEvents[K]) {
    if (!this.listeners.has(event)) return;
    for (const handler of this.listeners.get(event)!) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[GameEventBus] Error in handler for "${event}":`, err);
      }
    }
  }

  public clear() {
    this.listeners.clear();
  }
}
