import { GameEventBus, EngineEvaluation } from '../events/GameEventBus';
import { MoveManager } from './MoveManager';
import { EngineManager, DEFAULT_TARGET_DEPTH, MAX_CONTINUOUS_DEPTH } from '../engine/EngineManager';
import { EvalNormalizer } from '../analysis/EvalNormalizer';
import { AccuracyScore } from '../analysis/AccuracyScore';
import { MoveClassifier } from '../pedagogy/MoveClassifier';
import { EvalCache } from '../cache/EvalCache';
import { OpeningExplorer } from '../explorer/OpeningExplorer';
import { TheoryDetector } from '../explorer/TheoryDetector';
import type { OpeningData } from '../explorer/ExplorerCache';
import { MoveRecord, MoveNode, MoveTheory } from '../pedagogy/types';
import { ExplanationEngine } from '../pedagogy/ExplanationEngine';
import type { CoachCard, PlayerLevel } from '../pedagogy/ExplanationContext';
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
  private lastConfirmedTheoryPly?: number;
  private theoryUiTimeout: ReturnType<typeof setTimeout> | null = null;
  private warmFen: string | null = null;
  private readonly targetDepth = DEFAULT_TARGET_DEPTH;
  /**
   * Identifiant d'import : incrémenté à chaque `analyzeGame` ET à chaque
   * `reset()`/`resetPending()`, ce qui annule proprement un import en cours
   * (sinon deux imports concurrents s'écrasent mutuellement).
   */
  private importRunId = 0;
  private movePlaySeq = 0;
  private playerLevel: PlayerLevel = 'intermediaire';
  private activeNodeId: string | null = null;
  private llmInFlightKeys = new Set<string>();
  private llmCompletedKeys = new Set<string>();

  /**
   * Remplace de façon IMMUABLE la `coachCard` d'un enregistrement déjà stocké :
   * sans clonage du `MoveRecord`, l'état React (`prev`) garderait une référence
   * vers l'objet muté et croirait `prev[idx].coachCard === next[idx].coachCard`
   * (ignorant silencieusement toutes les fiches LLM asynchrones).
   */
  private updateRecordCoachCard(nodeId: string, card: CoachCard): MoveRecord | null {
    const current = this.recordsByNodeId.get(nodeId);
    if (!current) return null;
    const updated: MoveRecord = { ...current, coachCard: card };
    this.recordsByNodeId.set(nodeId, updated);
    const idx = this.moveRecords.findIndex(r => r.nodeId === nodeId);
    if (idx >= 0) {
      this.moveRecords[idx] = updated;
    } else {
      this.syncMoveRecordsWithTree();
    }
    return updated;
  }

  private getPreviousClassification(nodeId: string): string | null {
    const idx = this.moveRecords.findIndex(r => r.nodeId === nodeId);
    return idx > 0 ? this.moveRecords[idx - 1].classification : null;
  }

  private llmRequestKey(record: MoveRecord, level: PlayerLevel): string {
    return `${record.nodeId}:${level}:${record.theory?.openingName ?? ''}:${record.theory?.isTheory ? 1 : 0}`;
  }

  private requestLlmCard(
    record: MoveRecord,
    level: PlayerLevel,
    previousClassification: string | null
  ): void {
    const key = this.llmRequestKey(record, level);
    if (this.llmInFlightKeys.has(key) || this.llmCompletedKeys.has(key)) return;
    if (record.coachCard?.source === 'llm' && record.coachCard.level === level && !record.theory) {
      return;
    }

    this.llmInFlightKeys.add(key);
    ExplanationEngine.generateCard(record, level, previousClassification)
      .then((card) => {
        this.llmInFlightKeys.delete(key);
        const latest = this.recordsByNodeId.get(record.nodeId);
        if (!latest || this.playerLevel !== level) return;
        const normalizedCard: CoachCard = card.source
          ? card
          : { ...card, source: card.degraded ? 'fallback' : 'llm' };
        if (normalizedCard.source === 'llm') {
          this.llmCompletedKeys.add(key);
        }
        const updated = this.updateRecordCoachCard(record.nodeId, normalizedCard);
        if (updated) {
          this.eventBus.emit('PedagogyUpdated', updated);
        }
      })
      .catch((error) => {
        this.llmInFlightKeys.delete(key);
        console.error('[AnalysisPipeline] Coach card failed:', error);
      });
  }

  public setPlayerLevel(level: PlayerLevel): void {
    if (this.playerLevel === level) return;
    this.playerLevel = level;
    let updated = false;
    for (const [nodeId, rec] of this.recordsByNodeId) {
      if (rec.coachCard) {
        const localCard = ExplanationEngine.buildLocalCard(
          rec,
          level,
          this.getPreviousClassification(nodeId)
        );
        this.recordsByNodeId.set(nodeId, { ...rec, coachCard: localCard });
        updated = true;
      }
    }
    if (updated) {
      this.syncMoveRecordsWithTree();
      const target =
        (this.activeNodeId ? this.recordsByNodeId.get(this.activeNodeId) : undefined) ??
        this.moveRecords.at(-1);
      if (target) {
        this.eventBus.emit('PedagogyUpdated', target);
        this.requestLlmCard(target, level, this.getPreviousClassification(target.nodeId));
      }
    }
  }

  public getPlayerLevel(): PlayerLevel {
    return this.playerLevel;
  }

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
      const seq = ++this.movePlaySeq;
      this.activeNodeId = nodeId;
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
      if (seq !== this.movePlaySeq) return;
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
      if (this.theoryUiTimeout) {
        clearTimeout(this.theoryUiTimeout);
        this.theoryUiTimeout = null;
      }
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
            if (this.theoryUiTimeout) {
              clearTimeout(this.theoryUiTimeout);
              this.theoryUiTimeout = null;
            }
            if (this.pedagogyDone && this.latestEval && this.latestEval.fen === fenAfter) {
              // Important : passer `false` pour ne pas traiter ce rafraîchissement théorique
              // comme un import PGN massif (sinon l'appel au coach IA est court-circuité !).
              this.runPedagogy(this.latestEval, false);
            }
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
      if (seq !== this.movePlaySeq) return;
      if (
        this.pendingMove?.fenAfter === fenAfter &&
        cached &&
        (cached.depth >= this.targetDepth || typeof cached.mate === 'number')
      ) {
        this.latestEval = cached;
        this.pedagogyDone = true;
        this.eventBus.emit('EngineEvaluationUpdated', cached);
        this.maybeRunPedagogy();
        // Approfondissement continu en tâche de fond si en dessous du plafond
        if (typeof cached.mate !== 'number' && cached.depth < MAX_CONTINUOUS_DEPTH) {
          this.engineManager.analyze(
            fenAfter,
            this.targetDepth,
            this.moveManager.getIrreversibleHistory(),
            true
          );
        }
        return;
      }

      // Succession 3 : Sonde Cloud Eval (prioritaire sur le calcul local, 3 PV partagées avec l'UI)
      CloudEvalService.fetch(fenAfter, 3)
        .then((cloudEvals) => {
          if (!cloudEvals || cloudEvals.length === 0) return;
          const cloudBest = cloudEvals[0];
          if (
            seq === this.movePlaySeq &&
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

      // Succession 4 : Repli sur le moteur Stockfish local avec approfondissement continu
      this.engineManager.analyze(
        fenAfter,
        this.targetDepth,
        this.moveManager.getIrreversibleHistory(),
        true
      );
    });

    // Race navigation/analyse : invalider toute analyse en cours
    this.eventBus.on('NavigateTo', ({ nodeId }) => {
      this.movePlaySeq++;
      this.activeNodeId = nodeId;
      this.pendingMove = null;
      this.warmFen = null;
      this.latestEval = null;
      this.pendingTheory = undefined;
      this.theoryResolved = true;
      this.pedagogyDone = false;
      this.syncMoveRecordsWithTree();

      // Si l'utilisateur consulte un coup issu d'un import PGN massif, d'une
      // reprise localStorage ou d'un autre niveau, on l'enrichit à la volée via le LLM.
      if (nodeId) {
        const rec = this.recordsByNodeId.get(nodeId);
        if (rec) {
          const prevClass = this.getPreviousClassification(nodeId);
          if (!rec.coachCard) {
            const local = ExplanationEngine.buildLocalCard(rec, this.playerLevel, prevClass);
            const updated = this.updateRecordCoachCard(nodeId, local);
            if (updated) this.eventBus.emit('PedagogyUpdated', updated);
          }
          const current = this.recordsByNodeId.get(nodeId) ?? rec;
          const needsLlmUpgrade =
            !current.coachCard ||
            current.coachCard.source === 'local' ||
            current.coachCard.level !== this.playerLevel;
          if (needsLlmUpgrade && typeof window !== 'undefined') {
            this.requestLlmCard(current, this.playerLevel, prevClass);
          }
        }
      }
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

    // Si la recherche théorique est encore en cours, on attend au maximum 1500 ms
    // uniquement si l'on est encore potentiellement dans l'ouverture ; passé le
    // milieu de partie ou après sortie confirmée du répertoire, publication immédiate.
    if (!this.theoryResolved && this.pendingMove) {
      const { color, moveNumber, fenBefore } = this.pendingMove;
      const currentPly = color === 'white' ? moveNumber * 2 - 1 : moveNumber * 2;
      const pieceCount = fenBefore.split(' ')[0]?.replace(/[^a-zA-Z]/g, '').length ?? 32;
      const pastOpening =
        currentPly > (this.lastConfirmedTheoryPly ?? 0) + 6 ||
        pieceCount <= 22;

      if (!pastOpening) {
        if (!this.theoryUiTimeout) {
          this.theoryUiTimeout = setTimeout(() => {
            this.theoryUiTimeout = null;
            if (this.pedagogyDone && !this.theoryResolved && this.pendingMove && this.latestEval) {
              // Publication sans théorie : le diagnostic sera complété dès réception de l'API
              this.runPedagogy(this.latestEval);
            }
          }, 1500);
        }
        return;
      }
    }

    if (this.theoryUiTimeout) {
      clearTimeout(this.theoryUiTimeout);
      this.theoryUiTimeout = null;
    }

    this.runPedagogy(latest);
  }

  private buildTheory(
    uci: string,
    fenBefore: string,
    data: OpeningData | null,
    opening: { eco: string; name: string } | null
  ): MoveTheory {
    const detection = TheoryDetector.detect({
      fen: fenBefore,
      uci,
      data,
      opening,
      lastConfirmedPly: this.lastConfirmedTheoryPly,
    });

    if (detection.status === 'confirmed' && this.pendingMove) {
      const ply =
        this.pendingMove.color === 'white'
          ? this.pendingMove.moveNumber * 2 - 1
          : this.pendingMove.moveNumber * 2;
      this.lastConfirmedTheoryPly = ply;
    }

    return {
      ...detection,
      inBook: detection.status === 'confirmed',
      isTheory: detection.status === 'confirmed',
      games: detection.masterGamesForMove,
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

  private syncMoveRecordsWithTree() {
    const history = this.moveManager.getHistory();
    const tree = this.moveManager.getTree();
    const visited = new Set<string>();
    const branchNodes: MoveNode[] = [...history];
    for (const n of branchNodes) visited.add(n.id);

    let cursor: MoveNode | undefined = branchNodes.at(-1);
    if (!cursor && tree.nodes.size > 0) {
      let rootMain: MoveNode | undefined;
      for (const n of tree.nodes.values()) {
        if (n.parentId === null) {
          if (n.isMainline) {
            rootMain = n;
            break;
          }
          if (!rootMain) rootMain = n;
        }
      }
      if (rootMain) {
        branchNodes.push(rootMain);
        visited.add(rootMain.id);
        cursor = rootMain;
      }
    }

    while (cursor && cursor.childrenIds.length > 0) {
      const nextId = cursor.childrenIds[0];
      if (!nextId || visited.has(nextId)) break;
      const nextNode = tree.nodes.get(nextId);
      if (!nextNode) break;
      branchNodes.push(nextNode);
      visited.add(nextNode.id);
      cursor = nextNode;
    }

    if (branchNodes.length > 0) {
      const synced: MoveRecord[] = [];
      for (const node of branchNodes) {
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

    // Best move from BEFORE the move :
    // Un coup qui porte l'échec et mat '#' sur l'adversaire est optimal (mat direct),
    // à condition que le joueur ne subissait pas lui-même un mat forcé déjà inévitable (Cas 3).
    const isActualCheckmateDelivered = isCheckmateMove && (!evalBefore?.mate || evalBefore.mate > 0);
    const bestMove = isActualCheckmateDelivered
      ? uci
      : evalBefore && evalBefore.pv.length > 0
        ? evalBefore.pv[0]
        : undefined;

    const isBestMove = Boolean(
      isActualCheckmateDelivered || (bestMove && bestMove === uci)
    );

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

    // 3. Classification (jugement Lichess d'abord, évaluation d'éclat P2.13 ensuite)
    const { classification, accuracy, mateSequence } = MoveClassifier.classify(winDrop, {
      isBestMove,
      isTheory: theory?.isTheory ?? false,
      prevScore,
      nextScore,
      fenBefore,
      playedMove: uci,
      bestMove,
      pv: evalBefore?.pv,
      multiPvGap,
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
      this.playerLevel,
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
      this.requestLlmCard(analysis, this.playerLevel, previous?.classification ?? null);
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

    this.eventBus.emit('AnalysisStarted', undefined as never);

    // O5: Pré-chargement Cloud Eval par paquets de 6 positions simultanées
    const uniqueFens = new Set<string>();
    for (const node of nodes) {
      uniqueFens.add(node.fenBefore);
      uniqueFens.add(node.fenAfter);
    }
    const fenList = Array.from(uniqueFens);
    const BATCH_SIZE = 6;

    for (let i = 0; i < fenList.length; i += BATCH_SIZE) {
      if (isCancelled()) return;
      const batch = fenList.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (fen) => {
          if (this.getTerminalEvaluation(fen)) return;
          const cached = await this.evalCache.get(fen);
          if (cached && (cached.depth >= this.targetDepth || typeof cached.mate === 'number')) return;
          try {
            const cloudEvals = await CloudEvalService.fetch(fen, 1);
            if (cloudEvals && cloudEvals.length > 0) {
              const cloudBest = cloudEvals[0];
              if (cloudBest.depth >= this.targetDepth || typeof cloudBest.mate === 'number') {
                await this.evalCache.set(fen, cloudBest);
              }
            }
          } catch {
            // Repli transparent sur l'évaluation locale ultérieure
          }
        })
      );
      this.eventBus.emit('GameAnalysisProgress', {
        current: Math.min(i + batch.length, fenList.length),
        total: fenList.length,
        phase: 'cloud',
      });
    }

    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (isCancelled()) return;

      this.eventBus.emit('GameAnalysisProgress', {
        current: index + 1,
        total: nodes.length,
        phase: 'pedagogy',
      });

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

    this.eventBus.emit('AnalysisFinished', undefined as never);

    // Après un import PGN massif, génère automatiquement la fiche LLM du coup affiché.
    if (typeof window !== 'undefined' && this.moveRecords.length > 0) {
      const active =
        (this.activeNodeId ? this.recordsByNodeId.get(this.activeNodeId) : undefined) ??
        this.moveRecords.at(-1);
      if (active) {
        this.requestLlmCard(active, this.playerLevel, this.getPreviousClassification(active.nodeId));
      }
    }
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

    // Succession 4 : Fallback local Stockfish WASM avec approfondissement continu
    this.engineManager.analyze(currentFen, this.targetDepth, undefined, true);
  }

  public getEvalCache(): EvalCache {
    return this.evalCache;
  }

  public getMoveRecords(): MoveRecord[] {
    return this.moveRecords.map(r => ({ ...r }));
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
    this.movePlaySeq++;
    this.pendingMove = null;
    this.evalBeforeMove = null;
    this.latestEval = null;
    this.pendingTheory = undefined;
    this.theoryResolved = false;
    this.pedagogyDone = false;
    this.lastConfirmedTheoryPly = undefined;
    if (this.theoryUiTimeout) {
      clearTimeout(this.theoryUiTimeout);
      this.theoryUiTimeout = null;
    }
    this.warmFen = null;
  }

  public reset() {
    this.moveRecords = [];
    this.recordsByNodeId.clear();
    this.multiPvsByFen.clear();
    this.llmInFlightKeys.clear();
    this.llmCompletedKeys.clear();
    this.activeNodeId = null;
    this.resetPending();
  }
}
