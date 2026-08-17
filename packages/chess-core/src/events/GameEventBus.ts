export type EngineEvaluation = {
  depth: number;
  cp?: number;
  mate?: number;
  pv: string[];
  multiPv?: number;
  fen?: string;
};

export type HeatmapData = {
  [square: string]: {
    whiteInfluence: number;
    blackInfluence: number;
  };
};

import { MoveRecord, GameStats } from '../pedagogy/types';

export type GameEvents = {
  MovePlayed: { fenBefore: string; fenAfter: string; move: string; nodeId: string };
  PositionChanged: { fen: string };
  EngineEvaluationUpdated: EngineEvaluation;
  ThreatEvaluationUpdated: EngineEvaluation;
  BestMoveChanged: { move: string };
  HeatmapUpdated: HeatmapData;
  PedagogyUpdated: MoveRecord;
  MoveRecorded: MoveRecord;
  AccuracyUpdated: GameStats;
  OpeningDetected: { eco: string; name: string };
  NavigateTo: { fen: string; nodeId: string | null };
  AnalysisStarted: never;
  AnalysisFinished: never;
  ThreatAnalysisStarted: never;
  // C5 — Erreur du moteur Stockfish Worker
  EngineError: string;
};

type EventHandler<T> = (data: T) => void;

type AnyHandler = (data: never) => void;

export class GameEventBus {
  private listeners: Map<keyof GameEvents, AnyHandler[]> = new Map();

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
        (handler as EventHandler<GameEvents[K]>)(data);
      } catch (err) {
        console.error(`[GameEventBus] Error in handler for "${event}":`, err);
      }
    }
  }

  public clear() {
    this.listeners.clear();
  }
}
