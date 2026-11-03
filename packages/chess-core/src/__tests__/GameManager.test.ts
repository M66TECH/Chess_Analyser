import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameManager } from '../game/GameManager';

/**
 * GameManager drives MoveManager + AnalysisPipeline + EngineManager. The engine
 * is replaced by a spy: these tests focus on tree navigation and PGN loading.
 */
function createManager() {
  const gm = new GameManager();
  const analyze = vi.fn();
  const analyzeThreat = vi.fn();
  const reinit = vi.fn();
  const engine = gm.engineManager as unknown as {
    analyze: typeof analyze;
    analyzeThreat: typeof analyzeThreat;
    reinit: typeof reinit;
  };
  engine.analyze = analyze;
  engine.analyzeThreat = analyzeThreat;
  engine.reinit = reinit;
  return { gm, analyze, reinit };
}

describe('GameManager', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('expose le nodeId du coup joué', async () => {
    const { gm, analyze } = createManager();
    const result = gm.playMove('e2e4');
    expect(result.success).toBe(true);
    expect(result.nodeId).toBeTruthy();
    expect(gm.getActiveNodeId()).toBe(result.nodeId);
    // MovePlayed handler is async (cache lookup) before launching the engine.
    await new Promise(r => setTimeout(r, 0));
    expect(analyze).toHaveBeenCalled();
  });

  it('signale un coup illégal sans changer de nœud actif', () => {
    const { gm } = createManager();
    const result = gm.playMove('e1e8');
    expect(result.success).toBe(false);
    expect(gm.getActiveNodeId()).toBeNull();
  });

  it('navigateLast atteint la fin de la ligne principale', () => {
    const { gm } = createManager();
    gm.playMove('e2e4');
    gm.playMove('e7e5');
    gm.playMove('g1f3');

    gm.navigateFirst();
    expect(gm.getActiveNodeId()).toBeNull();

    gm.navigateLast();
    const tree = gm.getTree();
    const active = gm.getActiveNodeId();
    expect(active).toBeTruthy();
    expect(tree.nodes.get(active!)!.san).toBe('Nf3');
  });

  it('navigatePrev/navigateNext parcourent l\'arbre pas à pas', () => {
    const { gm } = createManager();
    gm.playMove('e2e4');
    gm.playMove('e7e5');

    gm.navigatePrev();
    expect(gm.getTree().nodes.get(gm.getActiveNodeId()!)!.san).toBe('e4');

    gm.navigatePrev();
    expect(gm.getActiveNodeId()).toBeNull();

    gm.navigateNext();
    expect(gm.getTree().nodes.get(gm.getActiveNodeId()!)!.san).toBe('e4');
  });

  it('resetGame vide la partie et réinitialise le pipeline', () => {
    const { gm } = createManager();
    gm.playMove('e2e4');
    gm.resetGame();
    expect(gm.getActiveNodeId()).toBeNull();
    expect(gm.getMoveRecords()).toHaveLength(0);
    expect(gm.getTree().nodes.size).toBe(0);
  });

  it('refuse un PGN invalide', async () => {
    const { gm } = createManager();
    const result = await gm.loadPgn('ceci n\'est pas du pgn');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('charge une partie PGN et rejoue les coups', async () => {
    const { gm } = createManager();
    // analyzeGame attend des évaluations: on le neutralise.
    const pipeline = gm.pipeline as unknown as { analyzeGame: () => Promise<void> };
    pipeline.analyzeGame = vi.fn(async () => {});

    const result = await gm.loadPgn('1. e4 e5 2. Nf3 *');
    expect(result.success).toBe(true);
    expect(result.moveCount).toBe(3);
    expect(gm.getTree().nodes.get(gm.getActiveNodeId()!)!.san).toBe('Nf3');
  });

  it('charge un PGN avec en-tête [FEN] personnalisé et rejoue les coups depuis ce FEN', async () => {
    const { gm } = createManager();
    const pipeline = gm.pipeline as unknown as { analyzeGame: () => Promise<void> };
    pipeline.analyzeGame = vi.fn(async () => {});

    const customPgn = `[Event "Custom FEN"]
[SetUp "1"]
[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]

1. Rh8+ Kf7 *`;

    const result = await gm.loadPgn(customPgn);
    expect(result.success).toBe(true);
    expect(result.moveCount).toBe(2);
    expect(gm.getTree().nodes.get(gm.getActiveNodeId()!)!.san).toBe('Kf7');
  });
});
