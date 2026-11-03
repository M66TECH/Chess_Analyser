import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalysisPipeline } from '../services/AnalysisPipeline';
import { MoveManager } from '../services/MoveManager';
import { GameEventBus, EngineEvaluation } from '../events/GameEventBus';
import { OpeningExplorer } from '../explorer/OpeningExplorer';
import type { EngineManager } from '../engine/EngineManager';
import { MoveClassifier } from '../pedagogy/MoveClassifier';
import { EvalNormalizer } from '../analysis/EvalNormalizer';

/**
 * Conformité de bout en bout au jugement de Lichess
 * (`modules/tree/Advice.scala`, `CpAdvice` + `MateAdvice`).
 *
 * Table de référence (delta BRUT sur [-1,1], seuils .1/.2/.3, sans /2) :
 *   50 cp → 0.0918 good | 100 → 0.1821 inaccuracy | 120 → 0.2174 mistake
 *   170 → 0.3031 blunder | 200 → 0.3524 blunder | 300 → 0.5023 blunder
 */
class FakeEngine {
  public analyze = vi.fn();
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function evaluation(overrides: Partial<EngineEvaluation>): EngineEvaluation {
  return { depth: 14, cp: 0, pv: [], multiPv: 1, ...overrides };
}

async function analyzeMove(
  beforeCp: number,
  after: { cp?: number; mate?: number },
  bestMoveBefore = 'd2d4'
) {
  const eventBus = new GameEventBus();
  const moveManager = new MoveManager();
  const pipeline = new AnalysisPipeline(eventBus, moveManager, new FakeEngine() as unknown as EngineManager);

  pipeline.initialize(START);
  eventBus.emit('EngineEvaluationUpdated', evaluation({ fen: START, cp: beforeCp, pv: [bestMoveBefore] }));

  const move = moveManager.playMove('e2e4');
  eventBus.emit('MovePlayed', {
    fenBefore: START,
    fenAfter: moveManager.getFen(),
    move: 'e2e4',
    nodeId: move.nodeId!,
  });
  await new Promise(r => setTimeout(r, 0));

  // ⚠ `after` est exprimé en POV **adversaire** (c'est le trait après le coup),
  // convention UCI réelle du moteur. Le pipeline inverse ensuite vers POV joueur.
  eventBus.emit(
    'EngineEvaluationUpdated',
    evaluation({ fen: moveManager.getFen(), cp: after.cp ?? 0, mate: after.mate, pv: ['e7e5'] })
  );

  return pipeline.getMoveRecords()[0];
}

describe('Conformité du jugement à Advice.scala (bout en bout)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(OpeningExplorer, 'fetchWithOpening').mockResolvedValue({ data: null, opening: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('coup neutre (POV adversaire -30) : best, précision ~100', async () => {
    const record = await analyzeMove(30, { cp: -30 }, 'e2e4');
    expect(record.classification).toBe('best');
    expect(record.accuracy).toBe(100);
  });

  it('50 cp perdus : aucune erreur (0.0918 < 0.1) — classé best (meilleur coup joué)', async () => {
    const record = await analyzeMove(50, { cp: 0 }, 'e2e4');
    expect(['good', 'best']).toContain(record.classification);
    expect(['inaccuracy', 'mistake', 'blunder']).not.toContain(record.classification);
  });

  it('ne pénalise jamais le meilleur coup de Stockfish même si l\'évaluation baisse par effet d\'horizon (Analysis.scala#L37)', async () => {
    const record = await analyzeMove(150, { cp: 0 }, 'e2e4');
    expect(record.classification).toBe('best');
    expect(record.accuracy).toBe(100);
  });

  it('100 cp perdus : inaccuracy (0.1821 ≥ 0.1) — le verdict réel de Lichess', async () => {
    const record = await analyzeMove(100, { cp: 0 });
    expect(record.classification).toBe('inaccuracy');
  });

  it('150 cp perdus : mistake (0.2693 ≥ 0.2)', async () => {
    const record = await analyzeMove(150, { cp: 0 });
    expect(record.classification).toBe('mistake');
  });

  it('200 cp perdus : blunder (0.3524 ≥ 0.3)', async () => {
    const record = await analyzeMove(200, { cp: 0 });
    expect(record.classification).toBe('blunder');
  });

  it('mate en 2 contre le joueur (POV adversaire +2) : MateCreated → blunder', async () => {
    // Blanc était à +30, il se fait mater : prevCp=30 ≥ -700 → blunder.
    const record = await analyzeMove(30, { mate: 2 });
    expect(record.classification).toBe('blunder');
    expect(record.mateSequence).toBe('created');
  });

  it('MateCreated avec prev < -700 : seulement une erreur (seuil lila)', async () => {
    // Le joueur était déjà largement perdu (-750) : se faire mater n'est
    // plus qu'une « erreur » selon Advice.scala (≥ -700 → Mistake).
    const drop = EvalNormalizer.winningChancesDiff(-750, -500, 'white');
    void drop;
    const judgment = MoveClassifier.classify(0, {
      prevScore: { cp: -750 },
      nextScore: { mate: -2 },
    });
    expect(judgment.classification).toBe('mistake');
    expect(judgment.mateSequence).toBe('created');
  });

  it('MateCreated avec prev < -999 : inaccuracy (position déjà perdue)', () => {
    const judgment = MoveClassifier.classify(0, {
      prevScore: { cp: -1200 },
      nextScore: { mate: -1 },
    });
    expect(judgment.classification).toBe('inaccuracy');
    expect(judgment.mateSequence).toBe('created');
  });

  it('MateLost avec reste > 700 cp : erreur ; > 999 : inaccuracy', () => {
    // Le joueur avait mate +2 (POV joueur), il lui reste +800 : erreur.
    const lost800 = MoveClassifier.classify(0, {
      prevScore: { mate: 2 },
      nextScore: { cp: 800 },
    });
    expect(lost800.classification).toBe('mistake');
    expect(lost800.mateSequence).toBe('lost');

    // Il lui reste +1200 : toujours totalement gagnant → inaccuracy.
    const lost1200 = MoveClassifier.classify(0, {
      prevScore: { mate: 2 },
      nextScore: { cp: 1200 },
    });
    expect(lost1200.classification).toBe('inaccuracy');

    // Il ne reste que +300 : gaffe.
    const lost300 = MoveClassifier.classify(0, {
      prevScore: { mate: 2 },
      nextScore: { cp: 300 },
    });
    expect(lost300.classification).toBe('blunder');
  });

  it('MateDelayed : pas de jugement Lichess (le mat reste forcé)', () => {
    const delayed = MoveClassifier.classify(0, {
      prevScore: { mate: 2 },
      nextScore: { mate: 3 },
    });
    expect(delayed.mateSequence).toBeUndefined();
    expect(['good', 'best']).toContain(delayed.classification);
  });

  it('symétrie parfaite des verdicts entre Blancs et Noirs', async () => {
    const whiteDrop = EvalNormalizer.winningChancesDiff(300, 0, 'white');
    const blackDrop = EvalNormalizer.winningChancesDiff(-300, 0, 'black');
    expect(whiteDrop).toBeCloseTo(blackDrop, 12);
    expect(MoveClassifier.classify(whiteDrop).classification)
      .toBe(MoveClassifier.classify(blackDrop).classification);
  });

  it('un coup qui améliore la position n\'est jamais pénalisé', async () => {
    // +20 → +250 POV Blanc = POV adversaire -250.
    const record = await analyzeMove(20, { cp: -250 });
    expect(record.accuracy).toBe(100);
    expect(['best', 'brilliant', 'great', 'excellent', 'good']).toContain(record.classification);
  });

  it('les évaluations du record restent en POV Blanc', async () => {
    // Blanc 120 → -80 = POV adversaire +80.
    const record = await analyzeMove(120, { cp: 80 });
    expect(record.cpBefore).toBe(120);
    expect(record.cpAfter).toBe(-80);
    expect(record.winProbAfter).toBeLessThan(record.winProbBefore);
  });
});
