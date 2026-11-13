import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EngineManager } from '../engine/EngineManager';
import { GameEventBus, EngineEvaluation } from '../events/GameEventBus';

/** Worker factice : enregistre les commandes et rejoue des réponses UCI. */
class FakeWorker {
  public onmessage: ((e: MessageEvent) => void) | null = null;
  public onerror: ((e: ErrorEvent) => void) | null = null;
  public onmessageerror: (() => void) | null = null;
  public sent: string[] = [];
  public terminated = false;

  postMessage(msg: string) {
    this.sent.push(msg);
  }

  terminate() {
    this.terminated = true;
  }

  emit(msg: string) {
    this.onmessage?.({ data: msg } as MessageEvent);
  }
}

const FEN_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN_OTHER = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function setup() {
  const eventBus = new GameEventBus();
  const engine = new EngineManager(eventBus);
  const worker = new FakeWorker();
  const internals = engine as unknown as {
    worker: FakeWorker;
    isReady: boolean;
    handleMessage: (e: MessageEvent) => void;
  };
  internals.worker = worker;
  internals.isReady = true;
  worker.onmessage = internals.handleMessage.bind(engine);
  return { eventBus, engine, worker, internals };
}

describe('EngineManager', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialisation (uciok → readyok)', () => {
    it('configure les options Lichess puis envoie isready', () => {
      const eventBus = new GameEventBus();
      const engine = new EngineManager(eventBus);
      const worker = new FakeWorker();
      const internals = engine as unknown as {
        worker: FakeWorker;
        handleMessage: (e: MessageEvent) => void;
      };
      internals.worker = worker;
      worker.onmessage = internals.handleMessage.bind(engine);

      worker.emit('uciok');

      expect(worker.sent).toContain('setoption name UCI_AnalyseMode value true');
      expect(worker.sent).toContain('setoption name Analysis Contempt value Off');
      // MultiPV 1 par défaut : 3 lignes coûtent ~3× le temps de recherche.
      expect(worker.sent).toContain('setoption name MultiPV value 1');
      expect(worker.sent).toContain('isready');
      expect(worker.sent).not.toContain('setoption name UCI_Chess960 value true');
    });

    it('setMultiPv monte le MultiPV à la demande et borne à [1, 5]', () => {
      const { engine, worker } = setup();
      engine.setMultiPv(3);
      expect(worker.sent).toContain('setoption name MultiPV value 3');
      expect(engine.multiPv).toBe(3);

      engine.setMultiPv(99);
      expect(worker.sent).toContain('setoption name MultiPV value 5');
      expect(engine.multiPv).toBe(5);

      engine.setMultiPv(0);
      expect(worker.sent).toContain('setoption name MultiPV value 1');
      expect(engine.multiPv).toBe(1);

      // Pas de commande redondante si la valeur ne change pas.
      const before = worker.sent.length;
      engine.setMultiPv(1);
      expect(worker.sent.length).toBe(before);
    });

    it('passe à prêt sur readyok', () => {
      const { worker, internals } = setup();
      internals.isReady = false;
      worker.emit('readyok');
      expect(internals.isReady).toBe(true);
    });

    it('ne démarre l\'analyse qu\'après readyok et oublie les demandes obsolètes', () => {
      const eventBus = new GameEventBus();
      const engine = new EngineManager(eventBus);
      const worker = new FakeWorker();
      const internals = engine as unknown as {
        worker: FakeWorker;
        isReady: boolean;
        handleMessage: (e: MessageEvent) => void;
      };
      internals.worker = worker;
      internals.isReady = false;
      worker.onmessage = internals.handleMessage.bind(engine);

      engine.analyze(FEN_START, 14);
      engine.analyze(FEN_OTHER, 14);
      expect(worker.sent).toHaveLength(0);

      worker.emit('readyok');

      expect(worker.sent).toContain(`position fen ${FEN_OTHER}`);
      expect(worker.sent).not.toContain(`position fen ${FEN_START}`);
      expect(worker.sent).toContain('go depth 14');
    });

    it('préserve le mode menaces demandé avant que le moteur soit prêt', () => {
      const eventBus = new GameEventBus();
      const engine = new EngineManager(eventBus);
      const worker = new FakeWorker();
      const internals = engine as unknown as {
        worker: FakeWorker;
        isReady: boolean;
        handleMessage: (e: MessageEvent) => void;
      };
      internals.worker = worker;
      internals.isReady = false;
      worker.onmessage = internals.handleMessage.bind(engine);

      const threatFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
      engine.analyzeThreat(threatFen, 10);
      expect(worker.sent).toHaveLength(0);

      worker.emit('readyok');

      // Le FEN envoyé doit être celui avec trait inversé (mode menaces),
      // pas la position normale : l'intention de l'utilisateur est préservée.
      expect(worker.sent).toContain(`position fen ${threatFen}`);
      const startedEmit = worker.sent.indexOf('go depth 10');
      expect(startedEmit).toBeGreaterThan(-1);
    });
  });

  describe('analyse', () => {
    it('envoie position + go quand le moteur est libre (sans barrière inutile)', () => {
      const { engine, worker } = setup();
      engine.analyze(FEN_START, 12);
      expect(worker.sent).toEqual([`position fen ${FEN_START}`, 'go depth 12']);
    });

    it('barrière stop → isready → readyok → go si une recherche tourne', () => {
      const { engine, worker, internals } = setup();

      // Première analyse : moteur libre, envoi direct.
      engine.analyze(FEN_START, 12);
      expect(worker.sent).toEqual([`position fen ${FEN_START}`, 'go depth 12']);

      // Seconde analyse alors que la première n'a pas rendu `bestmove`.
      engine.analyze(FEN_OTHER, 12);
      expect(worker.sent).toEqual([
        `position fen ${FEN_START}`,
        'go depth 12',
        'stop',
        'isready',
      ]);

      // Barrière franchie : le `go` de la seconde analyse part.
      internals.handleMessage({ data: 'readyok' } as MessageEvent);
      expect(worker.sent).toEqual([
        `position fen ${FEN_START}`,
        'go depth 12',
        'stop',
        'isready',
        `position fen ${FEN_OTHER}`,
        'go depth 12',
      ]);
    });

    it('émet AnalysisStarted', () => {
      const { engine, eventBus } = setup();
      const started = vi.fn();
      eventBus.on('AnalysisStarted', started);
      engine.analyze(FEN_START);
      expect(started).toHaveBeenCalledTimes(1);
    });

    it('étiquette chaque évaluation avec le FEN analysé et bloque les résidus avant readyok', () => {
      const { engine, worker, eventBus } = setup();
      const received: EngineEvaluation[] = [];
      eventBus.on('EngineEvaluationUpdated', e => received.push(e));

      engine.analyze(FEN_START, 10);
      worker.emit('info depth 8 score cp 34 pv e2e4');

      // Nouvelle position pendant qu'une recherche tourne → barrière stop/isready.
      engine.analyze(FEN_OTHER, 10);
      // Un `info` résiduel ou `bestmove` de l'ancienne recherche ne doit JAMAIS
      // être étiqueté avec `FEN_OTHER` ni déclencher `go` avant `readyok`.
      worker.emit('info depth 9 score cp 50 pv d2d4');
      worker.emit('bestmove d2d4');
      expect(worker.sent).not.toContain(`position fen ${FEN_OTHER}`);

      // Franchissement de la barrière `readyok` : seule l'analyse de FEN_OTHER démarre.
      worker.emit('readyok');
      worker.emit('info depth 8 score cp -12 pv e7e5');

      expect(received).toHaveLength(2);
      expect(received[0].fen).toBe(FEN_START);
      expect(received[0].cp).toBe(34);
      expect(received[1].fen).toBe(FEN_OTHER);
      expect(received[1].cp).toBe(-12);
    });

    it('transmet depth, pv et multipv', () => {
      const { engine, worker, eventBus } = setup();
      let last: EngineEvaluation | undefined;
      eventBus.on('EngineEvaluationUpdated', e => { last = e; });

      engine.analyze(FEN_START, 10);
      worker.emit('info depth 15 multipv 2 score cp 12 pv d2d4 d7d5');

      expect(last!.depth).toBe(15);
      expect(last!.multiPv).toBe(2);
      expect(last!.pv).toEqual(['d2d4', 'd7d5']);
    });
  });

  describe('filtrage des bornes (règle Lichess)', () => {
    it('ignore une borne sur la PV principale', () => {
      const { engine, worker, eventBus } = setup();
      const received: EngineEvaluation[] = [];
      eventBus.on('EngineEvaluationUpdated', e => received.push(e));

      engine.analyze(FEN_START, 10);
      worker.emit('info depth 5 multipv 1 score cp 20 lowerbound pv e2e4');

      expect(received).toHaveLength(0);
    });

    it('accepte une borne sur une PV secondaire (elle peut n\'en avoir qu\'une)', () => {
      const { engine, worker, eventBus } = setup();
      const received: EngineEvaluation[] = [];
      eventBus.on('EngineEvaluationUpdated', e => received.push(e));

      engine.analyze(FEN_START, 10);
      worker.emit('info depth 5 multipv 2 score cp 20 upperbound pv d2d4');

      expect(received).toHaveLength(1);
      expect(received[0].multiPv).toBe(2);
    });

    it('ignore "mate 0"', () => {
      const { engine, worker, eventBus } = setup();
      const received: EngineEvaluation[] = [];
      eventBus.on('EngineEvaluationUpdated', e => received.push(e));

      engine.analyze(FEN_START, 10);
      worker.emit('info depth 5 score mate 0 pv e2e4');

      expect(received).toHaveLength(0);
    });
  });

  describe('fin d\'analyse', () => {
    it('émet BestMoveChanged et AnalysisFinished sur bestmove', () => {
      const { engine, worker, eventBus } = setup();
      const best = vi.fn();
      const finished = vi.fn();
      eventBus.on('BestMoveChanged', best);
      eventBus.on('AnalysisFinished', finished);

      engine.analyze(FEN_START, 10);
      worker.emit('bestmove e2e4 ponder e7e5');

      expect(best).toHaveBeenCalledWith({ move: 'e2e4' });
      expect(finished).toHaveBeenCalledTimes(1);
    });

    it('émet AnalysisFinished même sans coup légal', () => {
      const { engine, worker, eventBus } = setup();
      const finished = vi.fn();
      const best = vi.fn();
      eventBus.on('AnalysisFinished', finished);
      eventBus.on('BestMoveChanged', best);

      engine.analyze(FEN_START, 10);
      worker.emit('bestmove (none)');

      expect(best).not.toHaveBeenCalled();
      expect(finished).toHaveBeenCalledTimes(1);
    });
  });

  describe('mode menaces', () => {
    it('inverse le trait et efface l\'en passant', () => {
      const { engine, eventBus, worker } = setup();
      const started = vi.fn();
      let received: EngineEvaluation | undefined;
      eventBus.on('ThreatAnalysisStarted', started);
      eventBus.on('ThreatEvaluationUpdated', e => { received = e; });

      engine.analyzeThreat('rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 2', 10);

      expect(started).toHaveBeenCalledTimes(1);
      expect(worker.sent).toContain('position fen rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 2');

      worker.emit('info depth 8 score cp 15 pv e5e4');
      expect(received!.fen).toContain(' b ');
    });

    it('n\'émet pas d\'évaluation normale en mode menaces', () => {
      const { engine, worker, eventBus } = setup();
      const normal = vi.fn();
      eventBus.on('EngineEvaluationUpdated', normal);

      engine.analyzeThreat(FEN_START, 10);
      worker.emit('info depth 8 score cp 15 pv e2e4');

      expect(normal).not.toHaveBeenCalled();
    });

    it('revient en mode normal après analyze()', () => {
      const { engine, worker, eventBus } = setup();
      const normal = vi.fn();
      eventBus.on('EngineEvaluationUpdated', normal);

      engine.analyzeThreat(FEN_START, 10);
      engine.analyze(FEN_START, 10);
      worker.emit('readyok');
      worker.emit('info depth 8 score cp 15 pv e2e4');

      expect(normal).toHaveBeenCalledTimes(1);
    });

    it('ignore un FEN invalide sans planter', () => {
      const { engine, worker } = setup();
      engine.analyzeThreat('invalid', 10);
      expect(worker.sent).toHaveLength(0);
    });
  });

  describe('cycle de vie', () => {
    it('stop() n\'annonce pas une fin d\'analyse', () => {
      const { engine, eventBus } = setup();
      const finished = vi.fn();
      eventBus.on('AnalysisFinished', finished);

      engine.stop();

      expect(finished).not.toHaveBeenCalled();
    });

    it('stop() envoie bien la commande au worker', () => {
      const { engine, worker } = setup();
      engine.stop();
      expect(worker.sent).toContain('stop');
    });

    it('reinit() vide la table de transposition', () => {
      const { engine, worker } = setup();
      engine.reinit();
      expect(worker.sent).toContain('ucinewgame');
    });

    it('terminate() coupe le worker et réinitialise l\'état', () => {
      const { engine, worker, internals } = setup();
      engine.terminate();
      expect(worker.terminated).toBe(true);
      expect(internals.worker).toBeNull();
      expect(internals.isReady).toBe(false);
    });

    it('ne plante pas sur les opérations après terminate()', () => {
      const { engine } = setup();
      engine.terminate();
      expect(() => {
        engine.analyze(FEN_START);
        engine.stop();
        engine.reinit();
        engine.analyzeThreat(FEN_START);
      }).not.toThrow();
    });
  });
});
