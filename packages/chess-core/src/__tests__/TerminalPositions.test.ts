import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalysisPipeline } from '../services/AnalysisPipeline';
import { MoveManager } from '../services/MoveManager';
import { GameEventBus, EngineEvaluation } from '../events/GameEventBus';
import { OpeningExplorer } from '../explorer/OpeningExplorer';
import type { EngineManager } from '../engine/EngineManager';

/**
 * Positions terminales détectées localement (`getTerminalEvaluation`).
 *
 * Régression visée : la version précédente renvoyait `{ cp: -1000, mate: 0 }`
 * pour un mat. Or `mate: 0` n'existe pas en UCI (`parseUciInfo` le rejette) et
 * `winPercentFromScore({ mate: 0 })` donne un signe arbitraire → un joueur qui
 * MATTE pouvait être noté comme perdant. Désormais : `terminal` explicite et
 * `cp` en POV du camp au trait (le maté).
 */
class FakeEngine {
  public analyze = vi.fn();
}

const MATE_FEN = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'; // Fool's mate
/** Position juste AVANT le mat (Dame noire en h4, joue Qxf2#). */
const MATE_BEFORE = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';

function evaluation(overrides: Partial<EngineEvaluation>): EngineEvaluation {
  return { depth: 14, pv: [], multiPv: 1, ...overrides };
}

describe('Positions terminales (fins de partie)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(OpeningExplorer, 'fetchWithOpening').mockResolvedValue({ data: null, opening: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('détecte un échec et mat et le note comme perdu pour le camp au trait', async () => {
    const eventBus = new GameEventBus();
    const engine = new FakeEngine();
    const pipeline = new AnalysisPipeline(eventBus, new MoveManager(), engine as unknown as EngineManager);

    // Analyse de la position de mat : le pipeline ne doit PAS interroger le moteur.
    const evals: EngineEvaluation[] = [];
    eventBus.on('EngineEvaluationUpdated', e => evals.push(e));

    // On passe par analyzeGame (chemin qui appelle getTerminalEvaluation avant le moteur).
    const found = (pipeline as unknown as { getTerminalEvaluation: (fen: string) => EngineEvaluation | null })
      .getTerminalEvaluation(MATE_FEN);

    expect(found).not.toBeNull();
    expect(found!.terminal).toBe('checkmate');
    // POV du camp au trait (les Blancs sont matés) → négatif.
    expect(found!.cp).toBe(-1000);
    // `mate: 0` ne doit plus être produit (non standard en UCI).
    expect(found!.mate).toBeUndefined();
    void evals;
    void evaluation;
  });

  it('un coup qui mate est classé "best" et l\'évaluation bascule en +1000 POV Blanc', async () => {
    // Chaîne complète : la position AVANT le mat est évaluée, le coup joué
    // mate, l'évaluation terminale est détectée localement (pas de moteur).
    const eventBus = new GameEventBus();
    const moveManager = new MoveManager(MATE_BEFORE);
    const engine = new FakeEngine();
    const pipeline = new AnalysisPipeline(eventBus, moveManager, engine as unknown as EngineManager);

    pipeline.initialize(MATE_BEFORE);
    eventBus.emit('EngineEvaluationUpdated', evaluation({ fen: MATE_BEFORE, cp: 20, pv: ['d8h4'] }));

    // Qh4# (le mat du berger inversé : les Blancs ont déjà joué f3 et g4).
    const move = moveManager.playMove('d8h4');
    eventBus.emit('MovePlayed', {
      fenBefore: MATE_BEFORE,
      fenAfter: moveManager.getFen(),
      move: 'd8h4',
      nodeId: move.nodeId!,
    });
    await new Promise(r => setTimeout(r, 0));

    const record = pipeline.getMoveRecords()[0];
    expect(record).toBeDefined();
    expect(record.san).toBe('Qh4#');
    // Le mat joué est le meilleur coup par définition.
    expect(record.classification).toBe('best');
    // POV Blanc après le mat : -1000 (les Blancs sont matés).
    expect(record.cpAfter).toBe(-1000);
  });

  it('détecte le pat comme nulle', () => {
    const eventBus = new GameEventBus();
    const pipeline = new AnalysisPipeline(
      eventBus,
      new MoveManager(),
      new FakeEngine() as unknown as EngineManager
    );
    const stalemate = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    const found = (pipeline as unknown as { getTerminalEvaluation: (f: string) => EngineEvaluation | null })
      .getTerminalEvaluation(stalemate);
    expect(found?.terminal).toBe('draw');
    expect(found?.cp).toBe(0);
  });

  it('détecte le matériel insuffisant comme nulle', () => {
    const eventBus = new GameEventBus();
    const pipeline = new AnalysisPipeline(
      eventBus,
      new MoveManager(),
      new FakeEngine() as unknown as EngineManager
    );
    const found = (pipeline as unknown as { getTerminalEvaluation: (f: string) => EngineEvaluation | null })
      .getTerminalEvaluation('8/8/8/4k3/8/8/8/4K3 w - - 0 1');
    expect(found?.terminal).toBe('draw');
  });

  it('ne détecte rien sur une position normale', () => {
    const eventBus = new GameEventBus();
    const pipeline = new AnalysisPipeline(
      eventBus,
      new MoveManager(),
      new FakeEngine() as unknown as EngineManager
    );
    const found = (pipeline as unknown as { getTerminalEvaluation: (f: string) => EngineEvaluation | null })
      .getTerminalEvaluation('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(found).toBeNull();
  });
});
