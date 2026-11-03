import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalysisPipeline } from '../services/AnalysisPipeline';
import { MoveManager } from '../services/MoveManager';
import { GameEventBus, EngineEvaluation } from '../events/GameEventBus';
import { OpeningExplorer } from '../explorer/OpeningExplorer';
import type { EngineManager } from '../engine/EngineManager';

/**
 * Minimal engine double: records the requested FENs and lets the test inject
 * evaluations, so the pipeline logic can be exercised without Stockfish.
 */
class FakeEngine {
  public requested: Array<{ fen: string; depth: number }> = [];
  public analyze = vi.fn((fen: string, depth: number) => {
    this.requested.push({ fen, depth });
  });
  public terminate = vi.fn();
}

function setup() {
  const eventBus = new GameEventBus();
  const moveManager = new MoveManager();
  const engine = new FakeEngine();
  const pipeline = new AnalysisPipeline(
    eventBus,
    moveManager,
    engine as unknown as EngineManager
  );
  return { eventBus, moveManager, engine, pipeline };
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function evaluation(overrides: Partial<EngineEvaluation>): EngineEvaluation {
  return { depth: 14, cp: 0, pv: [], multiPv: 1, ...overrides };
}

describe('AnalysisPipeline', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // No network in unit tests: pretend the opening database is unreachable.
    vi.spyOn(OpeningExplorer, 'fetchWithOpening').mockResolvedValue({ data: null, opening: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('analyse le coup joué et publie un record', async () => {
    const { eventBus, moveManager, engine, pipeline } = setup();

    // Seed evalBefore through the warm-up path (initial position analysis).
    pipeline.initialize(START);
    eventBus.emit('EngineEvaluationUpdated', evaluation({ fen: START, cp: 30, pv: ['e2e4'] }));

    const move = moveManager.playMove('e2e4');
    eventBus.emit('MovePlayed', {
      fenBefore: START,
      fenAfter: moveManager.getFen(),
      move: 'e2e4',
      nodeId: move.nodeId!,
    });
    // Let the async cache lookup resolve.
    await new Promise(r => setTimeout(r, 0));

    eventBus.emit(
      'EngineEvaluationUpdated',
      // POV adversaire : +25 POV Blanc = -25 pour les Noirs au trait.
      evaluation({ fen: moveManager.getFen(), cp: -25, pv: ['e7e5'] })
    );

    const records = pipeline.getMoveRecords();
    expect(records).toHaveLength(1);
    expect(records[0].playedMove).toBe('e2e4');
    expect(records[0].san).toBe('e4');
    expect(records[0].bestMove).toBe('e2e4');
    expect(records[0].classification).toBe('best');
    // The engine must have been asked to analyse the resulting position.
    expect(engine.requested.at(-1)!.fen).toBe(moveManager.getFen());
  });

  it('ignore les évaluations d\'une autre position (course navigation/analyse)', async () => {
    const { eventBus, moveManager, pipeline } = setup();

    const move = moveManager.playMove('e2e4');
    eventBus.emit('MovePlayed', {
      fenBefore: START,
      fenAfter: moveManager.getFen(),
      move: 'e2e4',
      nodeId: move.nodeId!,
    });
    await new Promise(r => setTimeout(r, 0));

    // Evaluation belonging to the starting position (user navigated back).
    eventBus.emit('EngineEvaluationUpdated', evaluation({ fen: START, cp: 500 }));

    expect(pipeline.getMoveRecords()).toHaveLength(0);
  });

  it('invalide l\'analyse en cours lors d\'une navigation', async () => {
    const { eventBus, moveManager, pipeline } = setup();

    const move = moveManager.playMove('e2e4');
    eventBus.emit('MovePlayed', {
      fenBefore: START,
      fenAfter: moveManager.getFen(),
      move: 'e2e4',
      nodeId: move.nodeId!,
    });
    await new Promise(r => setTimeout(r, 0));

    eventBus.emit('NavigateTo', { fen: START, nodeId: null });
    eventBus.emit(
      'EngineEvaluationUpdated',
      evaluation({ fen: moveManager.getFen(), cp: 25 })
    );

    expect(pipeline.getMoveRecords()).toHaveLength(0);
  });

  it('ne fabrique pas d\'évaluation avant coup si le cache est vide (E1)', async () => {
    const { eventBus, moveManager, pipeline } = setup();

    const move = moveManager.playMove('e2e4');
    eventBus.emit('MovePlayed', {
      fenBefore: START,
      fenAfter: moveManager.getFen(),
      move: 'e2e4',
      nodeId: move.nodeId!,
    });
    await new Promise(r => setTimeout(r, 0));

    eventBus.emit(
      'EngineEvaluationUpdated',
      evaluation({ fen: moveManager.getFen(), cp: -300 })
    );

    const records = pipeline.getMoveRecords();
    expect(records).toHaveLength(1);
    // Sans point de référence, aucune perte de chances n'est inventée.
    expect(records[0].accuracy).toBe(100);
    expect(records[0].classification).toBe('good');
    expect(records[0].bestMove).toBeUndefined();
  });

  it('conclut l\'analyse si le moteur rend la main avant la profondeur cible', async () => {
    const { eventBus, moveManager, pipeline } = setup();

    pipeline.initialize(START);
    eventBus.emit('EngineEvaluationUpdated', evaluation({ fen: START, cp: 20, pv: ['e2e4'] }));

    const move = moveManager.playMove('e2e4');
    eventBus.emit('MovePlayed', {
      fenBefore: START,
      fenAfter: moveManager.getFen(),
      move: 'e2e4',
      nodeId: move.nodeId!,
    });
    await new Promise(r => setTimeout(r, 0));

    // Mate found: Stockfish stops well before depth 14 and emits bestmove.
    eventBus.emit(
      'EngineEvaluationUpdated',
      evaluation({ fen: moveManager.getFen(), depth: 6, mate: 2, cp: undefined, pv: ['d8h4'] })
    );
    expect(pipeline.getMoveRecords()).toHaveLength(0);

    eventBus.emit('AnalysisFinished', undefined as never);
    expect(pipeline.getMoveRecords()).toHaveLength(1);
    expect(pipeline.getMoveRecords()[0].mateAfter).toBe(2);
  });

  it('réinitialise l\'état de session avec reset()', async () => {
    const { eventBus, moveManager, pipeline } = setup();
    pipeline.initialize(START);
    eventBus.emit('EngineEvaluationUpdated', evaluation({ fen: START, cp: 20 }));

    const move = moveManager.playMove('e2e4');
    eventBus.emit('MovePlayed', {
      fenBefore: START,
      fenAfter: moveManager.getFen(),
      move: 'e2e4',
      nodeId: move.nodeId!,
    });
    await new Promise(r => setTimeout(r, 0));
    eventBus.emit('EngineEvaluationUpdated', evaluation({ fen: moveManager.getFen(), cp: 20 }));
    expect(pipeline.getMoveRecords()).toHaveLength(1);

    pipeline.reset();
    expect(pipeline.getMoveRecords()).toHaveLength(0);
  });

  it('resetPending conserve les records mais abandonne l\'analyse en cours', async () => {
    const { eventBus, moveManager, pipeline } = setup();
    pipeline.initialize(START);
    eventBus.emit('EngineEvaluationUpdated', evaluation({ fen: START, cp: 20 }));

    const first = moveManager.playMove('e2e4');
    eventBus.emit('MovePlayed', {
      fenBefore: START,
      fenAfter: moveManager.getFen(),
      move: 'e2e4',
      nodeId: first.nodeId!,
    });
    await new Promise(r => setTimeout(r, 0));
    eventBus.emit('EngineEvaluationUpdated', evaluation({ fen: moveManager.getFen(), cp: 20 }));
    expect(pipeline.getMoveRecords()).toHaveLength(1);

    // A new move is played from an earlier node: the pending analysis is dropped.
    const second = moveManager.playMove('d2d4');
    pipeline.resetPending();
    eventBus.emit('EngineEvaluationUpdated', evaluation({ fen: moveManager.getFen(), cp: 20 }));

    const records = pipeline.getMoveRecords();
    expect(records).toHaveLength(1);
    expect(records[0].nodeId).toBe(first.nodeId);
    expect(records.some(r => r.nodeId === second.nodeId)).toBe(false);
  });
});
