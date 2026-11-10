import { GameEventBus, EngineEvaluation } from '../events/GameEventBus';
import { MoveManager } from './MoveManager';
import { EngineManager } from '../engine/EngineManager';
import { EvalNormalizer } from '../analysis/EvalNormalizer';
import { AccuracyScore } from '../analysis/AccuracyScore';
import { MoveClassifier } from '../pedagogy/MoveClassifier';
import { EvalCache } from '../cache/EvalCache';
import { OpeningExplorer } from '../explorer/OpeningExplorer';
import { OpeningBook } from '../explorer/OpeningBook';
import type { OpeningData } from '../explorer/ExplorerCache';
import { MoveRecord, MoveNode, MoveTheory } from '../pedagogy/types';
import { ExplanationEngine } from '../pedagogy/ExplanationEngine';
import { CloudEvalService } from './CloudEvalService';
import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';

interface PendingMove {
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
  color: 'white' | 'black';
  nodeId: string;
  moveNumber: number;
}

export class AnalysisPipeline {
  private evalCache = new EvalCache();
  private moveRecords: MoveRecord[] = [];
  private recordsByNodeId = new Map<string, MoveRecord>();
  private multiPvsByFen = new Map<string, Map<number, EngineEvaluation>>();

  // State for the currently analyzing move
  private pendingMove: PendingMove | null = null;
  private evalBeforeMove: EngineEvaluation | null = null;
  private latestEval: EngineEvaluation | null = null;
  /** Theory data for the pending move; null while the lookup is in flight. */
  private pendingTheory: MoveTheory | undefined = undefined;
  private theoryResolved = false;
  private pedagogyDone = false;
  private warmFen: string | null = null;
  private readonly targetDepth = 14;
  /**
   * Identifiant d'import : incrémenté à chaque `analyzeGame` ET à chaque
   * `reset()`/`resetPending()`, ce qui annule proprement un import en cours
   * (sinon deux imports concurrents s'écrasent mutuellement).
   */
  private importRunId = 0;

  constructor(
    private eventBus: GameEventBus,
    private moveManager: MoveManager,
    private engineManager: EngineManager
  ) {
    this.setupListeners();
  }

  /**
   * Détecte si `fen` est une position terminale (échec et mat, pat, matériel
   * insuffisant, règle des 50 coups ou triple répétition) afin de fournir une
   * évaluation exacte immédiate sans dépendre de `score mate 0` / `bestmove (none)`.
   *
   * ⚠ Convention : `cp` et `mate` sont en **POV du camp au trait** (convention
   * UCI du reste du moteur). Un mat signifie que le camp au trait est MATÉ :
   * l'évaluation est donc « infiniment perdante pour lui » → `cp: -1000`.
   * Le champ `mate` reste `undefined` : `mate: 0` n'existe pas dans le
   * protocole UCI (Stockfish l'omet), et `winPercentFromScore({mate: 0})`
   * donnerait un signe arbitraire. `terminal` sert à distinguer ce cas de
   * l'absence d'évaluation.
   */
  private getTerminalEvaluation(fen: string): EngineEvaluation | null {
    try {
      const setup = parseFen(fen).unwrap();
      const pos = Chess.fromSetup(setup).unwrap();
      if (pos.isCheckmate()) {
        // Le camp au trait n'a plus de coup légal et est en échec : il est mat.
        return {
          fen,
          depth: this.targetDepth,
          cp: -1000,
          pv: [],
          multiPv: 1,
          source: 'local',
          terminal: 'checkmate',
        };
      }
      if (
        pos.isStalemate() ||
        pos.isInsufficientMaterial() ||
        setup.halfmoves >= 100 ||
        (fen === this.moveManager.getFen() && this.moveManager.isThreefoldRepetition())
      ) {
        return {
          fen,
          depth: this.targetDepth,
          cp: 0,
          pv: [],
          multiPv: 1,
          source: 'local',
          terminal: 'draw',
        };
      }
    } catch {
      // Position non standard ou FEN partiel : laisser le moteur gérer.
    }
    return null;
  }

  private setupListeners() {
    this.eventBus.on('MovePlayed', async ({ fenBefore, fenAfter, move, nodeId }) => {
      // Get the node to extract SAN
      const tree = this.moveManager.getTree();
      const node = tree.nodes.get(nodeId);
      const san = node ? node.san : move;
      const color = node ? node.color : 'white';
      const nodeUci = node ? node.uci : move;

      // Retrieve eval BEFORE the move was played. A missing cached evaluation is
      // kept as null: substituting {cp: 0} would fabricate an "equal" starting
      // point and corrupt the accuracy of the very first move (E1).
      const evalBefore = await this.evalCache.get(fenBefore);
      this.evalBeforeMove = evalBefore ?? null;
      this.latestEval = null;
      this.pedagogyDone = false;

      this.pendingMove = {
        uci: nodeUci,
        san,
        fenBefore,
        fenAfter,
        color,
        nodeId,
        moveNumber: this.moveManager.getCurrentMoveNumber(),
      };
      this.warmFen = null;

      // Emit new position
      this.eventBus.emit('PositionChanged', { fen: fenAfter });

      // Ask the opening database about the position *before* the move: that is
      // where the played move has to be measured against human theory.
      this.pendingTheory = undefined;
      this.theoryResolved = false;
      const theoryPromise = OpeningExplorer.fetchWithOpening(fenBefore)
        .catch(() => ({ data: null as OpeningData | null, opening: null as { eco: string; name: string } | null }))
        .then(({ data, opening }) => {
          if (opening) {
            this.eventBus.emit('OpeningDetected', { eco: opening.eco, name: opening.name });
          }
          const pending = this.pendingMove;
          // Ignore a late answer for a move the user already left.
          if (pending && pending.fenAfter === fenAfter) {
            this.pendingTheory = this.buildTheory(nodeUci, fenBefore, data, opening);
            this.theoryResolved = true;
            this.maybeRunPedagogy();
          }
        });

      // Launch the engine right away; the theory answer joins when it arrives.
      void theoryPromise;

      // Succession 1 : Mat, pat ou nulle terminale
      const terminalEval = this.getTerminalEvaluation(fenAfter);
      if (terminalEval) {
        this.latestEval = terminalEval;
        this.pedagogyDone = true;
        this.evalCache.set(fenAfter, terminalEval);
        this.maybeRunPedagogy();
        return;
      }

      // Succession 2 : Cache local (EvalCache)
      const cached = await this.evalCache.get(fenAfter);
      if (
        this.pendingMove?.fenAfter === fenAfter &&
        cached &&
        (cached.depth >= this.targetDepth || typeof cached.mate === 'number')
      ) {
        this.latestEval = cached;
        this.pedagogyDone = true;
        this.eventBus.emit('EngineEvaluationUpdated', cached);
        this.maybeRunPedagogy();
        return;
      }

      // Succession 3 : Sonde Cloud Eval (prioritaire sur le calcul local)
      CloudEvalService.fetch(fenAfter, 1)
        .then((cloudEvals) => {
          if (!cloudEvals || cloudEvals.length === 0) return;
          const cloudBest = cloudEvals[0];
          if (
            this.pendingMove?.fenAfter === fenAfter &&
            !this.pedagogyDone &&
            (cloudBest.depth >= this.targetDepth || typeof cloudBest.mate === 'number')
          ) {
            this.engineManager.stop?.();
            this.latestEval = cloudBest;
            this.pedagogyDone = true;
            this.evalCache.set(fenAfter, cloudBest);
            this.eventBus.emit('EngineEvaluationUpdated', cloudBest);
            this.maybeRunPedagogy();
          }
        })
        .catch(() => {});

      // Succession 4 : Repli sur le moteur Stockfish local
      this.engineManager.analyze(
        fenAfter,
        this.targetDepth,
        this.moveManager.getIrreversibleHistory()
      );
    });

    // Race navigation/analyse : invalider toute analyse en cours
    this.eventBus.on('NavigateTo', () => {
      this.pendingMove = null;
      this.warmFen = null;
      this.latestEval = null;
      this.pendingTheory = undefined;
      this.theoryResolved = true;
      this.pedagogyDone = false;
      this.syncMoveRecordsWithTree();
    });

    this.eventBus.on('EngineEvaluationUpdated', (evaluation) => {
      // Si l'évaluation vient du cloud, on l'accepte si elle atteint la profondeur cible ou un mat
      if (evaluation.source === 'cloud') {
        const meetsTarget = evaluation.depth >= this.targetDepth || typeof evaluation.mate === 'number';
        if (!meetsTarget) return;
      }

      if (evaluation.fen) {
        let pvMap = this.multiPvsByFen.get(evaluation.fen);
        if (!pvMap) {
          pvMap = new Map();
          this.multiPvsByFen.set(evaluation.fen, pvMap);
        }
        pvMap.set(evaluation.multiPv ?? 1, evaluation);
      }

      // Only the primary PV line is used for caching and pedagogy triggers
      if (evaluation.multiPv && evaluation.multiPv !== 1) return;

      // A previously scheduled (stale) warm-up must never be written while a
      // real move is pending, otherwise it would pollute the eval cache.
      if (!this.pendingMove) {
        // Warm-up: cache the initial position eval so the first move's bestMove is available
        const isCloudReady = evaluation.source === 'cloud' && (evaluation.depth >= this.targetDepth || typeof evaluation.mate === 'number');
        const isLocalReady = evaluation.depth >= this.targetDepth;
        if (
          this.warmFen &&
          (isCloudReady || isLocalReady) &&
          evaluation.fen === this.warmFen
        ) {
          const fen = this.warmFen;
          this.warmFen = null;
          this.evalCache.set(fen, evaluation);
          if (evaluation.source === 'cloud') {
            this.engineManager.stop?.();
          }
        }
        return;
      }

      // Discard evaluations that belong to another position (navigation, rapid play)
      if (evaluation.fen && evaluation.fen !== this.pendingMove.fenAfter) return;

      // Undefined/FEN-less evaluations cannot be attributed to the pending move.
      if (!evaluation.fen) return;

      this.latestEval = evaluation;

      // Run pedagogy when reaching target depth, or immediately for cloud eval that has reached target depth/mate
      const isCloudReady = evaluation.source === 'cloud' && (evaluation.depth >= this.targetDepth || typeof evaluation.mate === 'number');
      const isLocalReady = evaluation.depth >= this.targetDepth;

      if (!this.pedagogyDone && (isCloudReady || isLocalReady)) {
        this.pedagogyDone = true;
        this.evalCache.set(this.pendingMove.fenAfter, evaluation);
        if (evaluation.source === 'cloud') {
          this.engineManager.stop?.();
        }
        this.maybeRunPedagogy();
      }
    });

    // E3 — The engine emits "bestmove" when a search ends before reaching the target
    // depth (mate found, engine stopped, ...). Use the latest evaluation received for
    // the pending position instead of waiting forever.
    this.eventBus.on('AnalysisFinished', () => {
      if (!this.pendingMove || this.pedagogyDone) return;
      const latest = this.latestEval;
      if (!latest || latest.fen !== this.pendingMove.fenAfter) return;
      this.pedagogyDone = true;
      this.evalCache.set(this.pendingMove.fenAfter, latest);
      this.maybeRunPedagogy();
    });
  }

  /**
   * Runs the pedagogy as soon as both the engine evaluation and the opening
   * database answer are available. Whichever finishes last triggers it, so the
   * coach never waits for a network call that already failed.
   */
  private maybeRunPedagogy() {
    const latest = this.latestEval;
    if (!this.pedagogyDone || !latest) return;
    if (this.pendingMove && latest.fen !== this.pendingMove.fenAfter) return;

    // Wait for the theory lookup only while it is genuinely in flight.
    if (!this.theoryResolved) return;

    this.runPedagogy(latest);
  }

  private buildTheory(
    uci: string,
    fenBefore: string,
    data: OpeningData | null,
    opening: { eco: string; name: string } | null
  ): MoveTheory | undefined {
    if (!data) return undefined;

    const ranked = OpeningBook.rank(fenBefore, data, fenBefore.split(' ')[1] === 'b' ? 'black' : 'white');
    if (ranked.length === 0) return undefined;

    const played = ranked.find(m => m.uci === uci);
    const best = ranked[0];

    // Consider a move theory when it is the main human choice or close enough
    // in popularity to the main line (e.g. equally played transpositions).
    const isTheory = !!played && played.frequency >= best.frequency * 0.5;

    return {
      inBook: true,
      eco: opening?.eco,
      openingName: opening?.name,
      frequency: played?.frequency,
      games: played?.games,
      isTheory,
    };
  }

  /**
   * Convertit une évaluation (POV du camp au trait APRÈS le coup = l'adversaire)
   * en score POV du joueur qui a bougé, pour le jugement `Advice.scala`.
   *
   * Cas particulier du mat détecté localement (`terminal: 'checkmate'`) : le
   * camp au trait est maté, donc du point de vue du joueur qui vient de jouer
   * c'est un mat **pour lui** → `mate: +1` (n'importe quelle valeur positive
   * suffit à `MateSequence`, qui ne regarde que le signe).
   */
  private toMoverPovScore(evalAfter: EngineEvaluation): { cp?: number; mate?: number } {
    if (evalAfter.terminal === 'checkmate') {
      return { mate: 1 };
    }
    return {
      cp: evalAfter.cp === undefined ? undefined : -evalAfter.cp,
      mate: evalAfter.mate === undefined ? undefined : -evalAfter.mate,
    };
  }

  private syncMoveRecordsWithTree() {    const history = this.moveManager.getHistory();
    if (history.length > 0) {
      const synced: MoveRecord[] = [];
      for (const node of history) {
        const rec = this.recordsByNodeId.get(node.id);
        if (rec) synced.push(rec);
      }
      this.moveRecords = synced;
    }
  }

  private runPedagogy(evalAfter: EngineEvaluation, isBulkImport = false) {
    if (!this.pendingMove) return;

    const { uci, san, fenBefore, fenAfter, color, nodeId, moveNumber } = this.pendingMove;

    // Without a trustworthy pre-move evaluation the move cannot be judged:
    // fall back to a neutral record instead of inventing an accuracy (E1).
    const evalBefore = this.evalBeforeMove;
    const sideToMoveAfter: 'white' | 'black' = color === 'white' ? 'black' : 'white';
    const isCheckmateMove = evalAfter.terminal === 'checkmate';

    // 1. Normalize scores (White's POV), accounting for the side to move (mate sign).
    // Un mat détecté localement est une évaluation en POV trait (le camp au
    // trait est maté) : `normalize(-1000, undefined, trait)` donne déjà
    // -1000 si le trait est aux Blancs, +1000 s'il est aux Noirs.
    const normCpBefore = evalBefore
      ? EvalNormalizer.normalize(evalBefore.cp, evalBefore.mate, color)
      : EvalNormalizer.normalize(evalAfter.cp, undefined, sideToMoveAfter);
    const normCpAfter = EvalNormalizer.normalize(evalAfter.cp, undefined, sideToMoveAfter);

    // 2. Winning chances dropped by the player (positive = lost chances)
    const winDrop = evalBefore
      ? EvalNormalizer.winningChancesDiff(normCpBefore, normCpAfter, color)
      : 0;

    // Best move from BEFORE the move (un coup qui réalise l'échec et mat `#`
    // est par définition optimal, même si plusieurs mats en 1 existaient).
    const bestMove = isCheckmateMove
      ? uci
      : evalBefore && evalBefore.pv.length > 0
        ? evalBefore.pv[0]
        : undefined;
    const isBestMove = isCheckmateMove || (!!bestMove && bestMove === uci);

    // Calcul de l'écart entre PV1 et PV2 sur fenBefore (si disponible)
    let multiPvGap: number | undefined;
    const beforePvs = this.multiPvsByFen.get(fenBefore);
    if (beforePvs && beforePvs.has(1) && beforePvs.has(2)) {
      const pv1 = beforePvs.get(1)!;
      const pv2 = beforePvs.get(2)!;
      const cp1 = EvalNormalizer.normalize(pv1.cp, pv1.mate, color);
      const cp2 = EvalNormalizer.normalize(pv2.cp, pv2.mate, color);
      multiPvGap = Math.max(0, EvalNormalizer.winningChancesDiff(cp1, cp2, color));
    }

    // Human theory: the Lichess database may consider this move normal even
    // though Stockfish's preferred line differs.
    const theory = this.pendingTheory;

    // Scores en POV du joueur pour le jugement Lichess (`Advice.scala`) :
    // `evalBefore` est déjà POV joueur (c'était son trait), `evalAfter` est
    // POV adversaire → signes inversés. Les champs cp/mate restent discrets :
    // lila exécute CpAdvice (deux cp) OU MateAdvice (mat impliqué), jamais un
    // mélange avec le mat replié en centipions.
    const prevScore = evalBefore
      ? { cp: evalBefore.cp, mate: evalBefore.mate }
      : undefined;
    const nextScore = this.toMoverPovScore(evalAfter);

    // 3. Classification (jugement Lichess d'abord, barème interne ensuite)
    const { classification, accuracy, mateSequence } = MoveClassifier.classify(winDrop, {
      isBestMove,
      isTheory: theory?.isTheory ?? false,
      prevScore,
      nextScore,
    });

    // Awareness & Luck
    let awareness: boolean | undefined = undefined;
    const prevRecord = this.moveRecords.length > 0 ? this.moveRecords[this.moveRecords.length - 1] : null;
    
    if (prevRecord) {
      // Si l'adversaire a fait une erreur au coup précédent
      const prevWasMistake = prevRecord.classification === 'mistake' || prevRecord.classification === 'blunder';
      if (prevWasMistake) {
        const weMistake = classification === 'mistake' || classification === 'blunder';
        awareness = !weMistake;
      }
      
      // Si on a fait une erreur au coup précédent, le coup actuel de l'adversaire détermine notre chance
      const weMistakePrev = prevRecord.classification === 'mistake' || prevRecord.classification === 'blunder';
      if (weMistakePrev) {
        const opponentMistake = classification === 'mistake' || classification === 'blunder';
        prevRecord.luck = opponentMistake;
      }
    }

    const analysis: MoveRecord = {
      fenBefore,
      fenAfter,
      playedMove: uci,
      bestMove,
      bestPv: evalBefore?.pv && evalBefore.pv.length > 0 ? evalBefore.pv : undefined,
      refutationPv: evalAfter.pv && evalAfter.pv.length > 0 ? evalAfter.pv : undefined,
      multiPvGap,
      cpBefore: normCpBefore,
      mateBefore: evalBefore?.mate,
      cpAfter: normCpAfter,
      mateAfter: evalAfter.mate,
      winProbBefore: EvalNormalizer.cpToWinningChances(normCpBefore),
      winProbAfter: EvalNormalizer.cpToWinningChances(normCpAfter),
      accuracy,
      classification,
      awareness,
      opening: theory?.openingName,
      theory,
      mateSequence,
      moveNumber,
      color,
      san,
      nodeId,
    };

    // Génère immédiatement la fiche locale déterministe (garantit une
    // explication vérifiée même hors-ligne ou pendant un import PGN massif).
    const previous = this.moveRecords.at(-1);
    analysis.coachCard = ExplanationEngine.buildLocalCard(
      analysis,
      'intermediaire',
      previous?.classification ?? null
    );

    this.recordsByNodeId.set(nodeId, analysis);
    const history = this.moveManager.getHistory();
    if (history.some(n => n.id === nodeId)) {
      this.syncMoveRecordsWithTree();
    } else {
      const existingIdx = this.moveRecords.findIndex(r => r.nodeId === nodeId);
      if (existingIdx >= 0) {
        this.moveRecords[existingIdx] = analysis;
      } else {
        this.moveRecords.push(analysis);
      }
    }

    this.eventBus.emit('PedagogyUpdated', analysis);
    this.eventBus.emit('MoveRecorded', analysis);
    this.eventBus.emit('AccuracyUpdated', AccuracyScore.computeGameStats(this.moveRecords));

    // Lors d'un import PGN massif (`isBulkImport`), on ne sature pas `/api/coach`
    // avec 80 requêtes LLM parallèles : la fiche locale enrichie suffit.
    if (!isBulkImport) {
      ExplanationEngine.generateCard(analysis, 'intermediaire', previous?.classification ?? null)
        .then(card => {
          analysis.coachCard = card;
          if (this.pendingMove?.nodeId === nodeId || this.moveRecords.at(-1)?.nodeId === nodeId) {
            this.eventBus.emit('PedagogyUpdated', analysis);
          }
        })
        .catch(error => {
          console.error('[AnalysisPipeline] Coach card failed:', error);
        });
    }
  }

  /**
   * Replays a PGN (nodes in mainline order) through the full analysis pipeline:
   * engine evaluation of every position + pedagogy. Sequential, awaiting the
   * target depth for each position before moving to the next.
   *
   * Fiabilité :
   * - `cancelRequested` permet d'abandonner un import en cours (nouvelle
   *   partie, nouvel import) : sans ça, deux imports concurrents écrasent
   *   mutuellement `pendingMove` et le second attend 30 s par position.
   * - Le timeout par position est plus court que la valeur par défaut
   *   d'`awaitEval` : un import de 80 coups ne peut pas bloquer 40 minutes si
   *   le moteur est lent. Les positions non conclues sont laissées de côté
   *   plutôt que d'immobiliser la file.
   */
  public async analyzeGame(nodes: MoveNode[], opts: { perMoveTimeoutMs?: number } = {}): Promise<void> {
    const perMoveTimeout = opts.perMoveTimeoutMs ?? 12_000;
    const runId = ++this.importRunId;
    const isCancelled = () => runId !== this.importRunId;

    this.pendingMove = null;
    this.pedagogyDone = false;
    this.warmFen = null;
    this.latestEval = null;
    this.pendingTheory = undefined;
    this.theoryResolved = false;
    if (nodes.length === 0) return;

    for (const node of nodes) {
      if (isCancelled()) return;

      // The pre-move evaluation is either the one cached for fenBefore or, for the
      // very first move, the one we compute right now. Never fabricate {cp: 0}.
      const evalBefore =
        (await this.evalCache.get(node.fenBefore)) ??
        (await this.awaitEval(node.fenBefore, this.targetDepth, perMoveTimeout));
      if (isCancelled()) return;
      if (!evalBefore) continue;
      this.evalCache.set(node.fenBefore, evalBefore);

      const evalAfter =
        (await this.evalCache.get(node.fenAfter)) ??
        (await this.awaitEval(node.fenAfter, this.targetDepth, perMoveTimeout));
      if (isCancelled()) return;
      if (!evalAfter) continue;
      this.evalCache.set(node.fenAfter, evalAfter);

      // Opening database lookup for this position (human theory).
      const { data, opening } = await OpeningExplorer.fetchWithOpening(node.fenBefore);
      if (isCancelled()) return;
      if (opening) {
        this.eventBus.emit('OpeningDetected', { eco: opening.eco, name: opening.name });
      }

      this.evalBeforeMove = evalBefore;
      this.latestEval = evalAfter;
      this.pendingMove = {
        uci: node.uci,
        san: node.san,
        fenBefore: node.fenBefore,
        fenAfter: node.fenAfter,
        color: node.color,
        nodeId: node.id,
        moveNumber: node.moveNumber,
      };
      this.pendingTheory = this.buildTheory(node.uci, node.fenBefore, data, opening);
      this.theoryResolved = true;
      // Prevent the event-driven handler from re-running this position
      this.pedagogyDone = true;
      this.runPedagogy(evalAfter, true);
    }

    this.pendingMove = null;
    this.evalBeforeMove = null;
    this.pedagogyDone = false;
    this.latestEval = null;
    this.pendingTheory = undefined;
    this.theoryResolved = false;
  }

  /**
   * Waits for the primary-PV evaluation of `fen` to reach `depth`.
   * Succession : 1. Terminal -> 2. Local Cache -> 3. Cloud Eval -> 4. Local Stockfish WASM
   */
  private async awaitEval(fen: string, depth: number = this.targetDepth, timeoutMs: number = 30000): Promise<EngineEvaluation | null> {
    // 1. Position terminale (mat, pat, nulle théorique) -> éval instantanée
    const terminalEval = this.getTerminalEvaluation(fen);
    if (terminalEval) {
      return terminalEval;
    }

    // 2. Cache local (EvalCache : IndexedDB / mémoire)
    const cached = await this.evalCache.get(fen);
    if (cached && (cached.depth >= depth || typeof cached.mate === 'number')) {
      return cached;
    }

    // 3. Nuage Lichess (Cloud Eval API) : vérifié en PREMIER avant de lancer le moteur local
    try {
      const cloudEvals = await CloudEvalService.fetch(fen, 1);
      if (cloudEvals && cloudEvals.length > 0) {
        const cloudBest = cloudEvals[0];
        if (cloudBest.depth >= depth || typeof cloudBest.mate === 'number') {
          await this.evalCache.set(fen, cloudBest);
          this.eventBus.emit('EngineEvaluationUpdated', cloudBest);
          return cloudBest;
        }
      }
    } catch {
      // Échec réseau ou position non trouvée, repli moteur local
    }

    // 4. Moteur local Stockfish WASM en repli
    return new Promise((resolve) => {
      let resolved = false;
      // Keep the deepest evaluation seen, so a search that ends before `depth`
      // (mate found, stop) still yields a usable score instead of null.
      let best: EngineEvaluation | null = null;
      const finish = (value: EngineEvaluation | null) => {
        if (resolved) return;
        resolved = true;
        this.eventBus.off('EngineEvaluationUpdated', handler);
        this.eventBus.off('AnalysisFinished', onFinished);
        clearTimeout(timer);
        resolve(value);
      };
      const handler = (evaluation: EngineEvaluation) => {
        if (resolved) return;
        if (evaluation.multiPv && evaluation.multiPv !== 1) return;
        if (evaluation.fen && evaluation.fen !== fen) return;
        if (!best || evaluation.depth > best.depth) best = evaluation;
        const isCloudReady = evaluation.source === 'cloud' && (evaluation.depth >= depth || typeof evaluation.mate === 'number');
        const isLocalReady = evaluation.depth >= depth;
        if (isCloudReady || isLocalReady) finish(evaluation);
      };
      // Un `bestmove` résiduel de la position précédente peut arriver avant la
      // première ligne `info` de la nouvelle position (`best === null`). On ne
      // conclut sur `AnalysisFinished` que si une évaluation de `fen` a été reçue.
      const onFinished = () => {
        if (best) finish(best);
      };
      const timer = setTimeout(() => finish(best), timeoutMs);
      this.eventBus.on('EngineEvaluationUpdated', handler);
      this.eventBus.on('AnalysisFinished', onFinished);
      this.engineManager.analyze(fen, depth);
    });
  }

  public async initialize(fen?: string) {
    const currentFen = fen || this.moveManager.getFen();
    this.eventBus.emit('PositionChanged', { fen: currentFen });
    this.warmFen = currentFen;

    // Succession 1 : Terminal check
    const terminalEval = this.getTerminalEvaluation(currentFen);
    if (terminalEval) {
      this.warmFen = null;
      this.evalCache.set(currentFen, terminalEval);
      this.eventBus.emit('EngineEvaluationUpdated', terminalEval);
      return;
    }

    // Succession 2 : EvalCache check
    const cached = await this.evalCache.get(currentFen);
    if (cached && (cached.depth >= this.targetDepth || typeof cached.mate === 'number')) {
      this.warmFen = null;
      this.eventBus.emit('EngineEvaluationUpdated', cached);
      return;
    }

    // Succession 3 : Cloud Eval probe
    CloudEvalService.fetch(currentFen, 1)
      .then((cloudEvals) => {
        if (!cloudEvals || cloudEvals.length === 0) return;
        const cloudBest = cloudEvals[0];
        if (
          this.warmFen === currentFen &&
          (cloudBest.depth >= this.targetDepth || typeof cloudBest.mate === 'number')
        ) {
          this.warmFen = null;
          this.evalCache.set(currentFen, cloudBest);
          this.engineManager.stop?.();
          this.eventBus.emit('EngineEvaluationUpdated', cloudBest);
        }
      })
      .catch(() => {});

    // Succession 4 : Fallback local Stockfish WASM
    this.engineManager.analyze(currentFen, this.targetDepth);
  }

  public getEvalCache(): EvalCache {
    return this.evalCache;
  }

  public getMoveRecords(): MoveRecord[] {
    return [...this.moveRecords];
  }

  /** Restaure des `MoveRecord` persistés (ex. `localStorage`) dans l'arbre courant. */
  public restoreMoveRecords(records: MoveRecord[]) {
    this.recordsByNodeId.clear();
    for (const r of records) {
      this.recordsByNodeId.set(r.nodeId, r);
    }
    this.syncMoveRecordsWithTree();
    if (this.moveRecords.length === 0 && records.length > 0) {
      this.moveRecords = [...records];
    }
  }

  /**
   * Drops the in-flight analysis without clearing the recorded moves.
   * Used when the board position changes by a path the pipeline did not see
   * (new move from an earlier node), so stale evaluations cannot be attributed
   * to the wrong move.
   */
  public resetPending() {
    // Invalide tout import PGN en cours (voir analyzeGame / importRunId).
    this.importRunId++;
    this.pendingMove = null;
    this.evalBeforeMove = null;
    this.latestEval = null;
    this.pendingTheory = undefined;
    this.theoryResolved = false;
    this.pedagogyDone = false;
    this.warmFen = null;
  }

  public reset() {
    this.moveRecords = [];
    this.recordsByNodeId.clear();
    this.multiPvsByFen.clear();
    this.resetPending();
  }
}
