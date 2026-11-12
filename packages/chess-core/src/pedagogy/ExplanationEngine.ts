import { RiverAPI } from './RiverAPI';
import { uciToSan, pvToSan } from '../utils/san';
import {
  buildExplanationContext,
  pieceToFr,
  type CoachCard,
  type ExplanationContext,
  type Insight,
  type PlayerLevel,
  type VerifiedTacticalFacts,
} from './ExplanationContext';
import { MotifEngine } from './MotifEngine';
import { describeMove } from './MoveNarrator';
import type { MoveRecord } from './types';

import { parseFen, makeFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { attacks } from 'chessops/attacks';
import { parseSan } from 'chessops/san';
import { makeSquare, parseSquare, parseUci } from 'chessops/util';
import type { Role } from 'chessops/types';

const ROLE_VALUE: Record<Role, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
};

function computeMaterialForColor(pos: Chess, color: 'white' | 'black'): number {
  let sum = 0;
  for (const sq of pos.board[color]) {
    const p = pos.board.get(sq);
    if (p) sum += ROLE_VALUE[p.role];
  }
  return sum;
}

/**
 * Simule les premiers coups UCI d'une variante et calcule le bilan matériel net
 * du point de vue de `playerColor` par rapport à `fenAfter`.
 */
function simulatePvMaterialDelta(
  fenAfter: string,
  pvUci: string[] | undefined,
  playerColor: 'white' | 'black',
  maxPlies = 6
): number {
  if (!pvUci || pvUci.length === 0) return 0;
  try {
    const setup = parseFen(fenAfter).unwrap();
    const pos = Chess.fromSetup(setup).unwrap();
    const oppColor: 'white' | 'black' = playerColor === 'white' ? 'black' : 'white';
    const initialDiff = computeMaterialForColor(pos, playerColor) - computeMaterialForColor(pos, oppColor);

    for (const uci of pvUci.slice(0, maxPlies)) {
      const move = parseUci(uci);
      if (!move || !pos.isLegal(move)) break;
      pos.play(move);
    }

    const finalDiff = computeMaterialForColor(pos, playerColor) - computeMaterialForColor(pos, oppColor);
    return finalDiff - initialDiff;
  } catch {
    return 0;
  }
}

/**
 * Extrait de manière 100 % déterministe les différences tactiques et
 * positionnelles entre `fenBefore` et `fenAfter` ainsi que la réfutation SAN.
 */
export function extractVerifiedTacticalFacts(record: MoveRecord): VerifiedTacticalFacts | undefined {
  try {
    const setupAfter = parseFen(record.fenAfter).unwrap();
    const motifsBefore = MotifEngine.analyzeFen(record.fenBefore);
    const motifsAfter = MotifEngine.analyzeFen(record.fenAfter);
    if (!motifsBefore || !motifsAfter) return undefined;

    const playerColor = record.color;
    const enemyColor: 'white' | 'black' = playerColor === 'white' ? 'black' : 'white';

    const beforeUndefendedSquares = new Set(motifsBefore.undefended.map(u => u.square));
    const newlyUndefendedOwn: VerifiedTacticalFacts['newly_undefended_own_pieces'] = [];
    const newlyUndefendedEnemy: VerifiedTacticalFacts['newly_undefended_enemy_pieces'] = [];

    for (const u of motifsAfter.undefended) {
      const piece = setupAfter.board.get(u.square);
      if (!piece) continue;
      const sqName = makeSquare(u.square);
      const attackerSqName = makeSquare(u.principalAttacker);
      const pieceName = pieceToFr(piece.role) ?? piece.role;

      if (piece.color === playerColor && !beforeUndefendedSquares.has(u.square)) {
        newlyUndefendedOwn.push({
          square: sqName,
          piece: pieceName,
          loss: u.materialLoss,
          attacker_square: attackerSqName,
        });
      } else if (piece.color === enemyColor && !beforeUndefendedSquares.has(u.square)) {
        newlyUndefendedEnemy.push({
          square: sqName,
          piece: pieceName,
          gain: u.materialLoss,
        });
      }
    }

    const beforePinnedSquares = new Set(motifsBefore.pins.map(p => p.pinned));
    const newPinsAgainstPlayer: VerifiedTacticalFacts['new_pins_against_player'] = [];
    const newPinsByPlayer: VerifiedTacticalFacts['new_pins_by_player'] = [];

    for (const p of motifsAfter.pins) {
      if (beforePinnedSquares.has(p.pinned)) continue;
      const pinnedPiece = setupAfter.board.get(p.pinned);
      const pinnerPiece = setupAfter.board.get(p.pinner);
      const targetPiece = setupAfter.board.get(p.target);
      if (!pinnedPiece || !pinnerPiece || !targetPiece) continue;

      const pinDescriptor = {
        pinned_square: makeSquare(p.pinned),
        pinned_piece: pieceToFr(pinnedPiece.role) ?? pinnedPiece.role,
        pinner_square: makeSquare(p.pinner),
        pinner_piece: pieceToFr(pinnerPiece.role) ?? pinnerPiece.role,
        target_square: makeSquare(p.target),
        is_absolute: targetPiece.role === 'king',
      };

      if (pinnedPiece.color === playerColor) {
        newPinsAgainstPlayer.push(pinDescriptor);
      } else {
        newPinsByPlayer.push(pinDescriptor);
      }
    }

    const posBefore = motifsBefore.positional;
    const posAfter = motifsAfter.positional;

    const diffList = (beforeArr: string[], afterArr: string[]) =>
      afterArr.filter(sq => !beforeArr.includes(sq));

    const refutationPvSan =
      record.refutationPv && record.refutationPv.length > 0
        ? pvToSan(record.fenAfter, record.refutationPv.slice(0, 5))
        : [];

    const materialDeltaInPv = simulatePvMaterialDelta(
      record.fenAfter,
      record.refutationPv,
      playerColor,
      6
    );

    return {
      fen_before: record.fenBefore,
      fen_after: record.fenAfter,
      refutation_pv_san: refutationPvSan,
      material_delta_in_pv: materialDeltaInPv,
      newly_undefended_own_pieces: newlyUndefendedOwn,
      newly_undefended_enemy_pieces: newlyUndefendedEnemy,
      new_pins_against_player: newPinsAgainstPlayer,
      new_pins_by_player: newPinsByPlayer,
      positional_changes: {
        doubled_pawns_created: diffList(posBefore.doubledPawns[playerColor], posAfter.doubledPawns[playerColor]),
        isolated_pawns_created: diffList(posBefore.isolatedPawns[playerColor], posAfter.isolatedPawns[playerColor]),
        passed_pawns_created: diffList(posBefore.passedPawns[playerColor], posAfter.passedPawns[playerColor]),
        undeveloped_minors_count: posAfter.undevelopedMinors[playerColor].length,
        open_files_near_king: posAfter.openFilesNearKing[playerColor],
      },
    };
  } catch {
    return undefined;
  }
}

function checkPieceExistsOnSquare(fen: string, role: Role, squareStr: string): boolean {
  try {
    const setup = parseFen(fen).unwrap();
    const sq = parseSquare(squareStr);
    if (sq === undefined) return false;
    const piece = setup.board.get(sq);
    return piece !== undefined && piece.role === role;
  } catch {
    return false;
  }
}

function doesPieceAttackRole(
  fen: string,
  fromSquareStr: string,
  targetRole: Role,
  targetColor: 'white' | 'black'
): boolean {
  try {
    const setup = parseFen(fen).unwrap();
    const sq = parseSquare(fromSquareStr);
    if (sq === undefined) return false;
    const piece = setup.board.get(sq);
    if (!piece) return false;
    const attackedSquares = attacks(piece, sq, setup.board.occupied);
    const targetPieces = setup.board[targetColor].intersect(setup.board[targetRole]);
    return attackedSquares.intersects(targetPieces);
  } catch {
    return true;
  }
}

/**
 * Coach IA : transforme le VERDICT de l'analyse Lichess en explications
 * accessibles. Il ne remplace jamais l'analyse : il la traduit.
 *
 * Architecture en deux temps :
 *   1. `buildContext` extrait des faits 100 % vérifiables (évaluations,
 *      classification, meilleur coup, variantes SAN, pièces en prise SEE,
 *      clouages et structure de pions) ;
 *   2. le modèle rédige des fiches courtes strictement bornées à ces faits.
 *
 * En cas d'échec du modèle (ou lors d'un import PGN massif), `fallbackCard`
 * produit une explication déterministe riche à partir des preuves calculées.
 */
export class ExplanationEngine {
  private static readonly SYSTEM_PROMPT = `# Rôle
Tu es ChessCoach, entraîneur d'échecs pour DÉBUTANTS. Tu lis une analyse déjà calculée (Stockfish + Lichess + faits géométriques vérifiés). Tu ne recalcules rien.

# Règle absolue : court et simple
- Le joueur débute. Il ne connaît pas la notation.
- INTERDIT d'écrire une notation seule : ni « Nf3 », ni « Bxc6 », ni « a4 », ni « e2e4 ».
- Nomme TOUJOURS la pièce en français (pion, cavalier, fou, tour, dame, roi) et indique sa case d'arrivée en clair : « le cavalier va en f3 ».
- Aucun jargon : ni « centipawn », ni « tempo », ni « structure », ni « zone », ni « initiative ».
- Pas de paragraphe. Une idée = une phrase de 15 mots maximum.

# Longueur imposée
- headline : 10 mots maximum. C'est le conseil principal.
- insights : 1 ou 2 maximum (jamais 3 ni 5). Chaque text ≤ 20 mots.
- takeaway : une seule phrase courte, actionnable.
- Si tu ne peux pas faire court, NE DIS RIEN de plus : la démonstration visuelle remplace l'explication.

# Structure conseillée
1. Le PROBLÈME, en une phrase (« votre dame peut être prise »).
2. L'ACTION recommandée, en une phrase (« mettez-la en sécurité en d1 »).
C'est tout. Le reste est inutile.

# Preuves
Le JSON fourni est la seule source. N'invente jamais une pièce en prise, un clouage ou une fourchette absents de tactical_facts. Si best.san existe, tu peux le décrire en français (« le fou va en c4 ») mais jamais en notation seule.
Si opening.is_theory_move est vrai, ne présente pas le coup comme une erreur.

# Séquences de mat
- created : « le mat devient inévitable ». lost : « vous aviez un mat et il est perdu ». delayed : pas une erreur.

# Langue
Réponds EXCLUSIVEMENT en français : aucun mot anglais dans les textes.
Adresse-toi au joueur en VOUVOYANT (« vous », « votre ») : jamais « tu » ni « ton ».
Les CLÉS du JSON restent en anglais pour la machine (headline, insights, kind, text, takeaway) — c'est le seul anglais autorisé.

# Format
Réponds UNIQUEMENT par un objet JSON valide :
{"headline":"...","insights":[{"kind":"played_move","text":"..."}],"takeaway":"..."}
kinds autorisés : played_move, missed_move, mistake, good_decision, consequence.`;

  /**
   * Budget LLM par session (P1-9). Compteur statique : une session =
   * un chargement de page. Au-delà du budget, on bascule sur le fallback
   * SANS consommer de quota : un import PGN de 80 coups ne doit pas
   * déclencher 80 appels LLM ruinant la clé API.
   */
  private static llmCallsThisSession = 0;
  private static readonly LLM_SESSION_BUDGET = 40;

  /** Budget restant pour cette session (transparence / tests). */
  public static get remainingLlmBudget(): number {
    return Math.max(0, this.LLM_SESSION_BUDGET - this.llmCallsThisSession);
  }

  /** Extraction déterministe des faits tactiques vérifiés (P0.1 & I1). */
  public static extractTacticalFacts = extractVerifiedTacticalFacts;

  /** Remet le budget à zéro (tests, nouvelle session). */
  public static resetLlmBudget(): void {
    this.llmCallsThisSession = 0;
  }

  /**
   * C6 : Tente de consommer un appel sur le budget LLM de session.
   * Retourne true si le budget est suffisant et a été décrémenté, false sinon.
   */
  public static tryConsumeBudget(): boolean {
    if (this.llmCallsThisSession >= this.LLM_SESSION_BUDGET) return false;
    this.llmCallsThisSession++;
    return true;
  }

  /** Génère la fiche pédagogique d'un coup analysé (avec appel IA + fallback local). */
  public static async generateCard(
    record: MoveRecord,
    level: PlayerLevel = 'intermediaire',
    previousClassification?: string | null
  ): Promise<CoachCard> {
    const context = this.buildContext(record, previousClassification);

    // Budget épuisé : fallback IMMÉDIAT, sans coût réseau, avec badge.
    if (!this.tryConsumeBudget()) {
      const local = this.fallbackCard(context, level);
      return { ...local, degraded: true };
    }

    try {
      const raw = await RiverAPI.complete(this.buildPrompt(context, level), this.SYSTEM_PROMPT, {
        temperature: 0.3,
        maxTokens: 900,
      });

      if (raw.startsWith('Le coach') || raw.startsWith('Impossible') || raw.startsWith('Analyse non disponible')) {
        console.info('[ExplanationEngine] Passerelle LLM indisponible, bascule sur la fiche pédagogique déterministe (mode dégradé).');
        const local = this.fallbackCard(context, level);
        return { ...local, degraded: true };
      }

      const parsed = this.parseCard(raw);

      if (parsed && isFrenchText([parsed.headline, parsed.takeaway, ...parsed.insights.map(i => i.text)].join(' '))) {
        // P0.1 : Contrôle de cohérence factuelle avec VerifiedTacticalFacts
        const consistency = ExplanationEngine.verifyCardFactualConsistency(parsed, context.tactical_facts, context);
        if (consistency.isValid) {
          // Le prompt demande la brièveté ; le code la GARANTIT. Le fallback
          // n'est pas nécessaire : carte LLM complète, non dégradée.
          return applyMoodLimits({ ...parsed, level }, context);
        }
        console.warn(`[ExplanationEngine] Fiche LLM rejetée pour incohérence factuelle (${consistency.reason}), bascule sur fallback local.`);
      } else {
        // Réponse non française ou unparseable : fallback avec badge.
        console.warn('[ExplanationEngine] Réponse LLM invalide ou non française, fallback local avec badge.');
      }

      const local = this.fallbackCard(context, level);
      return { ...local, degraded: true };
    } catch (error) {
      // LLM indisponible (clé expirée, réseau, timeout) : fallback + badge.
      console.error('[ExplanationEngine] LLM indisponible, fallback local avec badge:', error);
      const local = this.fallbackCard(context, level);
      return { ...local, degraded: true };
    }
  }

  /** Génère immédiatement une fiche pédagogique déterministe sans appel réseau. */
  public static buildLocalCard(
    record: MoveRecord,
    level: PlayerLevel = 'intermediaire',
    previousClassification?: string | null
  ): CoachCard {
    const context = this.buildContext(record, previousClassification);
    return this.fallbackCard(context, level);
  }

  /**
   * Construit le dossier factuel complet (évaluations + variantes SAN + motifs
   * tactiques SEE/clouages + structure de pions).
   */
  public static buildContext(record: MoveRecord, previousClassification?: string | null): ExplanationContext {
    let playedPiece: string | undefined;
    let capturedPiece: string | null = null;
    let materialCount: number | undefined;

    try {
      const setup = parseFen(record.fenBefore).unwrap();
      const pos = Chess.fromSetup(setup).unwrap();
      materialCount = pos.board.occupied.size();

      const move = parseSan(pos, record.san);
      if (move && 'from' in move) {
        const fromPiece = pos.board.get(move.from);
        if (fromPiece) playedPiece = pieceToFr(fromPiece.role);

        const toPiece = pos.board.get(move.to);
        if (toPiece) {
          capturedPiece = pieceToFr(toPiece.role) ?? null;
        } else if (fromPiece?.role === 'pawn' && move.to === pos.epSquare) {
          capturedPiece = 'pion (en passant)';
        }
      }
    } catch {
      // Le contexte reste utilisable même si la position est illisible.
    }

    const bestPvSan =
      record.bestPv && record.bestPv.length > 0
        ? pvToSan(record.fenBefore, record.bestPv.slice(0, 5))
        : undefined;

    const tacticalFacts = extractVerifiedTacticalFacts(record);

    return buildExplanationContext({
      record,
      playedPiece,
      capturedPiece,
      bestMoveSan: record.bestMove ? uciToSan(record.fenBefore, record.bestMove) : null,
      bestPvSan,
      previousClassification,
      materialCount,
      tacticalFacts,
    });
  }

  private static buildPrompt(context: ExplanationContext, level: PlayerLevel): string {
    const levelInstructions: Record<PlayerLevel, string> = {
      debutant:
        "Niveau du joueur : débutant. Phrases très courtes. Explique chaque terme d'échecs employé. Ne cite aucune variante.",
      intermediaire:
        "Niveau du joueur : intermédiaire. Tu peux nommer les motifs tactiques (fourchette, clouage) en une demi-phrase.",
      avance:
        "Niveau du joueur : avancé. Tu peux évoquer les plans et les structures de pions, en restant concis.",
    };

    const mood = moodFor(context);
    const maxInsights = mood.maxInsights;
    const maxWords = mood.maxWordsPerInsight;

    return `${levelInstructions[level]}

# Ton imposé pour ce cas précis
${mood.tone}

# Longueur imposée (ne pas dépasser)
- headline : ${mood.maxHeadlineWords} mots maximum.
- insights : ${maxInsights} maximum, ${maxWords} mots maximum chacun.
- takeaway : une seule phrase de ${mood.maxTakeawayWords} mots maximum.
- Si tu ne tiens pas dans ces limites, écris moins, pas plus long.

# Langue et adresse
- Réponds EXCLUSIVEMENT en français : aucun mot anglais.
- Vouvoie le joueur (« vous », « votre »), jamais « tu » ni « ton ».

# Interdits absolus
- Ne rejoue PAS les coups toi-même : l'application affiche la démonstration sur l'échiquier.
- N'écris aucune notation : ni « Nf3 », ni « e2e4 », ni « Bxc5 ».
- Pas de liste à puces, pas de paragraphe, pas de répétition.

# Séquence à ne pas décrire en texte
Les coups sont montrés visuellement (${context.best?.pv_san?.length ?? 0} coups).
Ne les raconte pas : commente seulement l'idée en une phrase.

Dossier d'analyse (JSON) :
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

Écris la fiche JSON demandée.`;
  }

  /**
   * Prompt de démonstration : décrit une séquence coup par coup, en laissant
   * l'application jouer les coups. Longueur bornée par le nombre de coups
   * fourni (une phrase par coup, jamais plus).
   */
  public static buildDemoPrompt(startFen: string, uciMoves: string[], kind: 'punish' | 'idea'): string {
    const count = uciMoves.length;
    const mood =
      kind === 'punish'
        ? "Le joueur vient de faire une erreur : montrez comment l'adversaire en profite. Ton calme, jamais moqueur."
        : "Montrez la bonne idée à jouer. Ton encourageant et positif.";

    return `${mood}

# Consignes (strictes)
- Explique brièvement la séquence suivante, coup par coup, en une phrase courte chacun (30 mots maximum, limite absolue).
- Réponds EXCLUSIVEMENT en français : aucun mot anglais dans les phrases.
- Vouvoie le joueur (« vous »), jamais « tu ».
- Ne rejoue PAS les coups toi-même : l'application s'en charge.
- Ne dépasse pas la longueur fournie : exactement ${count} phrases, une par coup, dans l'ordre.
- Nomme la pièce en français et sa case d'arrivée (« le cavalier va en f3 »).
- AUCUNE notation : ni « Nf3 », ni « e2e4 ».
- Une phrase décrit seulement ce qui se passe (prise, échec, menace). Pas de commentaire long.
- Si un coup n'apporte rien à comprendre, écris une phrase de 3 mots maximum.

SÉQUENCE : ${uciMoves.join(' ')}
POSITION DE DÉPART : ${startFen}

Réponds UNIQUEMENT par un tableau JSON de ${count} chaînes, sans texte autour :
["...","..."]`;
  }

  /**
   * Génère les phrases de la démonstration via le modèle, avec repli local.
   *
   * Garanties appliquées côté code (pas seulement demandées au prompt) :
   * - exactement une phrase par coup, jamais plus (on tronque) ;
   * - aucune notation brute : une phrase qui en contient est remplacée par la
   *   description déterministe de `MoveNarrator` ;
   * - longueur maximale par phrase.
   */
  public static async generateDemoCaptions(params: {
    startFen: string;
    uciMoves: string[];
    kind: 'punish' | 'idea';
    fallbackCaptions: string[];
  }): Promise<string[]> {
    const { startFen, uciMoves, kind, fallbackCaptions } = params;
    const captions = [...fallbackCaptions];

    if (uciMoves.length === 0) return captions;

    // C6 : Les démonstrations doivent également consommer le budget LLM de session
    if (!this.tryConsumeBudget()) return captions;

    try {
      const raw = await RiverAPI.complete(
        this.buildDemoPrompt(startFen, uciMoves, kind),
        'Tu es un coach d’échecs pour débutants. Tu réponds uniquement par un tableau JSON de phrases courtes.',
        { temperature: 0.4, maxTokens: 700 }
      );

      const parsed = parseStringArray(raw);
      if (!parsed) return captions;

      for (let i = 0; i < Math.min(parsed.length, captions.length); i++) {
        const clean = sanitizeCaption(parsed[i]);
        // Une phrase qui contient encore de la notation est écartée : on garde
        // la description déterministe (pièce + case), déjà vérifiée.
        if (clean) captions[i] = clean;
      }
    } catch (error) {
      console.error('[ExplanationEngine] Demo captions failed:', error);
    }

    return captions;
  }

  /** Parse la réponse du modèle en tolérant les fences Markdown éventuelles. */
  public static parseCard(raw: string): Omit<CoachCard, 'level'> | null {
    if (!raw) return null;

    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    // Certains modèles préfixent par du texte : on isole le premier objet JSON.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;

    let data: unknown;
    try {
      data = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }

    if (!data || typeof data !== 'object') return null;
    const obj = data as Record<string, unknown>;

    const headline = typeof obj.headline === 'string' ? obj.headline.trim() : '';
    const takeaway = typeof obj.takeaway === 'string' ? obj.takeaway.trim() : '';
    const rawInsights = Array.isArray(obj.insights) ? obj.insights : [];

    const allowed: Insight['kind'][] = ['played_move', 'missed_move', 'mistake', 'good_decision', 'consequence'];
    const insights: Insight[] = [];
    for (const item of rawInsights) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as Record<string, unknown>;
      const kind = typeof candidate.kind === 'string' ? candidate.kind : '';
      const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
      if (!allowed.includes(kind as Insight['kind']) || text.length === 0) continue;
      insights.push({ kind: kind as Insight['kind'], text });
    }

    if (headline.length === 0 && insights.length === 0 && takeaway.length === 0) return null;

    return { headline, insights, takeaway };
  }

  /**
   * P0.1 & Audit de Fiabilité : Contrôle exhaustif de cohérence factuelle avec VerifiedTacticalFacts et ExplanationContext.
   * Vérifie et rejette :
   *  1. Pièces en prise / indéfendues non prouvées
   *  2. Clouages absents
   *  3. Mats ou séquences de mat non certifiés
   *  4. Fourchettes / doubles attaques inventées
   *  5. Recommandations de coups alternatifs non concordants avec Stockfish
   *  6. Affirmations d'évaluation en contradiction avec les chiffres réels
   *  7. Pièces ou cases citées absentes de l'échiquier réel
   *  8. Incohérences de camp / couleur
   */
  public static verifyCardFactualConsistency(
    card: Omit<CoachCard, 'level'> | CoachCard,
    facts: VerifiedTacticalFacts | undefined,
    context: ExplanationContext
  ): { isValid: boolean; reason?: string } {
    const fullText = [
      card.headline,
      card.takeaway,
      ...card.insights.map((i) => i.text),
    ].join(' ');

    // Normalisation Unicode sans accents pour des détections fiables
    const norm = fullText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    // 1. Contrôle des affirmations de pièce en prise / indéfendue / non protégée
    const claimsHanging =
      /\b(en prise|non protegee?s?|indefendue?s?|sans defense|peut etre pris[ee]?s?|laisse (?:une|votre|la) piece)\b/i.test(norm);

    if (claimsHanging) {
      const hasHangingFact =
        (facts && (
          facts.newly_undefended_own_pieces.length > 0 ||
          facts.newly_undefended_enemy_pieces.length > 0 ||
          facts.material_delta_in_pv < 0
        )) ||
        Boolean(context.played.captured);

      if (!hasHangingFact) {
        return {
          isValid: false,
          reason: 'Affirmation de pièce en prise ou indéfendue sans fait tactique certifié.',
        };
      }
    }

    // 2. Contrôle des affirmations de clouage
    const claimsPin = /\b(clouage|cloue|clouee|cloues|clouees)\b/i.test(norm);
    if (claimsPin) {
      const hasPinFact =
        facts &&
        (facts.new_pins_against_player.length > 0 || facts.new_pins_by_player.length > 0);

      if (!hasPinFact) {
        return {
          isValid: false,
          reason: 'Affirmation de clouage sans clouage certifié dans les faits.',
        };
      }
    }

    // 3. Contrôle des affirmations de mat (échec et mat / mat inévitable)
    const claimsMate =
      /\b(echec et mat|fait mat|livre mat|est mat\b|vous matez|mat inevitable|mat imparable|va vous mater|se faire mater|menace de mat)\b/i.test(norm);

    if (claimsMate) {
      const hasMateFact =
        context.played.is_mate ||
        context.context.mate_sequence !== null ||
        context.evaluation.mate_before !== null ||
        context.evaluation.mate_after !== null;

      if (!hasMateFact) {
        return {
          isValid: false,
          reason: 'Affirmation de mat sans mat ou séquence de mat certifiée.',
        };
      }
    }

    // Résolution FEN résultante pour contrôles géométriques stricts
    let fenAfter = context.tactical_facts?.fen_after;
    if (!fenAfter) {
      try {
        const setup = parseFen(context.fen_before).unwrap();
        const pos = Chess.fromSetup(setup).unwrap();
        const m = parseUci(context.played.uci);
        if (m && pos.isLegal(m)) {
          pos.play(m);
          fenAfter = makeFen(pos.toSetup());
        }
      } catch {}
    }

    // 4. Contrôle des affirmations de fourchette / attaque double
    const claimsFork = /\b(fourchette|fourche|attaque double)\b/i.test(norm);
    if (claimsFork) {
      let hasForkFact = false;
      try {
        const motifsBefore = MotifEngine.analyzeFen(context.fen_before);
        const motifsAfter = fenAfter ? MotifEngine.analyzeFen(fenAfter) : null;
        if (
          (motifsBefore && motifsBefore.forks.length > 0) ||
          (motifsAfter && motifsAfter.forks.length > 0)
        ) {
          hasForkFact = true;
        }
      } catch {}

      if (!hasForkFact) {
        return {
          isValid: false,
          reason: 'Affirmation de fourchette ou attaque double sans fait tactique certifié.',
        };
      }
    }

    // 5. Contrôle des recommandations de coup alternatif (canoniques et non-canoniques, G1)
    const recRegexes = [
      /\b(?:vous devriez jouer|il fallait jouer|le meilleur coup (?:etait|est)|preferez|mieux valait)\s+([a-z0-9#+=!?-]+)/i,
      /\b([a-z0-9#+=!?-]+)\s+(?:est|etait|serait)\s+(?:une\s+)?(?:bonne|meilleure|excellente)\s+idee/i,
      /\b(?:jouer|en jouant)\s+([a-z0-9#+=!?-]+)\s+(?:etait|serait|permettait)/i,
      /\bavec\s+([a-z0-9#+=!?-]+)\s*,?\s*vous\s+(?:pouviez|aviez|gardiez)/i,
    ];

    const isLikelyChessMoveToken = (token: string): boolean =>
      /^(?:[o0]-[o0](?:-[o0])?|[rdtfckqbn]?[a-h]?[1-8]?x?[a-h][1-8](?:=[rdtfckqn])?)$/.test(token);

    const normalizeSanToken = (raw: string): string => {
      let cleaned = raw.replace(/[+#!?]+/g, '').trim();
      cleaned = cleaned.replace(/^([DCFTR])/, (_, p: string) => {
        const map: Record<string, string> = { D: 'Q', C: 'N', F: 'B', T: 'R', R: 'K' };
        return map[p] ?? p;
      });
      cleaned = cleaned.replace(/=([DCFTR])/i, (_, p: string) => {
        const map: Record<string, string> = { d: 'q', c: 'n', f: 'b', t: 'r', r: 'k' };
        return '=' + (map[p.toLowerCase()] ?? p.toLowerCase());
      });
      return cleaned.toLowerCase();
    };

    const fullNormOrig = fullText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let suggestedMoveRaw: string | null = null;
    for (const r of recRegexes) {
      const m = fullNormOrig.match(r);
      if (m && m[1]) {
        const candidateLower = m[1].replace(/[+#!?]+/g, '').replace(/=.*$/, '').trim().toLowerCase();
        if (isLikelyChessMoveToken(candidateLower)) {
          suggestedMoveRaw = normalizeSanToken(m[1]);
          break;
        }
      }
    }

    if (suggestedMoveRaw && suggestedMoveRaw.length >= 2 && context.best) {
      const bestSanRaw = (context.best.san ?? '').replace(/[+#=]/g, '').trim().toLowerCase();
      const bestUciRaw = (context.best.uci ?? '').toLowerCase();
      const firstPvSan =
        context.best.pv_san && context.best.pv_san[0]
          ? context.best.pv_san[0].replace(/[+#=]/g, '').trim().toLowerCase()
          : '';
      const suggestedComparable = suggestedMoveRaw.replace(/=/g, '');

      const matchesBest =
        Boolean(bestSanRaw && suggestedComparable === bestSanRaw) ||
        Boolean(bestUciRaw && suggestedComparable === bestUciRaw) ||
        Boolean(firstPvSan && suggestedComparable === firstPvSan) ||
        (Boolean(bestSanRaw) && bestSanRaw.includes(suggestedComparable)) ||
        (Boolean(bestUciRaw) && bestUciRaw.includes(suggestedComparable));

      if (!matchesBest) {
        return {
          isValid: false,
          reason: `Recommandation d'un coup alternatif ("${suggestedMoveRaw}") qui ne correspond pas au meilleur coup calculé (${context.best.san ?? 'meilleur coup inconnu'}).`,
        };
      }
    }

    // 6. Contrôle des affirmations d'évaluation (équilibre, polarité et chiffres réels, G2)
    const claimsBalanced =
      /\b(position est equilibree|partie est egale|parfaitement egal|position nulle|egalite parfaite)\b/i.test(norm);
    if (claimsBalanced) {
      const cpAfter = context.evaluation.after;
      const isActuallyBalanced =
        context.evaluation.mate_after === null &&
        cpAfter !== null &&
        Math.abs(cpAfter) <= 150;
      if (!isActuallyBalanced) {
        const displayScore =
          cpAfter !== null
            ? `${cpAfter > 0 ? '+' : ''}${(cpAfter / 100).toFixed(1)} pions`
            : 'mat';
        return {
          isValid: false,
          reason: `Affirmation de position équilibrée contredite par l'évaluation réelle (${displayScore}).`,
        };
      }
    }

    // Polarité du score du joueur
    const playerColor = context.played.color;
    const rawCpAfter = context.evaluation.after;
    const playerPovScore =
      rawCpAfter !== null ? (playerColor === 'white' ? rawCpAfter : -rawCpAfter) : null;

    const claimsFavorable =
      /\b(votre position est (?:bonne|excellente|tres bonne|gagnante|favorable)|vous (?:etes|avez l'?)avantage|avantage (?:net|decisif|confortable)|position avantageuse|vous dominez)\b/i.test(norm);
    if (claimsFavorable) {
      const isMateAgainst =
        context.evaluation.mate_after !== null &&
        (playerColor === 'white' ? context.evaluation.mate_after < 0 : context.evaluation.mate_after > 0);

      if (isMateAgainst || (playerPovScore !== null && playerPovScore < -100)) {
        return {
          isValid: false,
          reason: `Affirmation de position favorable contredite par l'évaluation négative (${playerPovScore !== null ? (playerPovScore / 100).toFixed(1) : 'mat contre vous'} pions).`,
        };
      }
    }

    // Perte chiffrée de pions
    const lossMatch = norm.match(/\b(?:perte|perdez)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*pions?\b/i);
    if (lossMatch && context.evaluation.player_loss_cp !== null) {
      const claimedLoss = parseFloat(lossMatch[1].replace(',', '.'));
      const realLoss = Math.max(0, context.evaluation.player_loss_cp / 100);
      if (Math.abs(claimedLoss - realLoss) > 1.0) {
        return {
          isValid: false,
          reason: `Affirmation de perte de ${claimedLoss} pion(s) contredite par la perte réelle de ${realLoss.toFixed(1)} pion(s).`,
        };
      }
    }

    // 7. Contrôle d'existence et de statut des pièces et cases citées
    const pieceSquareRegex = /\b(tour|cavalier|fou|dame|roi|pion)\s+(?:en\s+)?([a-h][1-8])\b/gi;
    let match: RegExpExecArray | null;

    const roleMap: Record<string, Role> = {
      pion: 'pawn',
      cavalier: 'knight',
      fou: 'bishop',
      tour: 'rook',
      dame: 'queen',
      roi: 'king',
    };

    while ((match = pieceSquareRegex.exec(norm)) !== null) {
      const pieceNameFr = match[1];
      const squareStr = match[2];
      const expectedRole = roleMap[pieceNameFr];

      if (expectedRole) {
        const existsBefore = checkPieceExistsOnSquare(context.fen_before, expectedRole, squareStr);
        const existsAfter = fenAfter ? checkPieceExistsOnSquare(fenAfter, expectedRole, squareStr) : false;

        if (!existsBefore && !existsAfter) {
          return {
            isValid: false,
            reason: `Affirmation hallucinatoire : aucun(e) ${pieceNameFr} sur la case ${squareStr} sur l'échiquier.`,
          };
        }

        const contextAround = norm.substring(
          Math.max(0, match.index - 40),
          Math.min(norm.length, match.index + 60)
        );
        const claimsThreatened = /\b(prise|prend|attaqu|capture|indefendu|menac)/i.test(contextAround);
        if (claimsThreatened && facts) {
          const playedFrom = context.played.uci.slice(0, 2);
          const playedTo = context.played.uci.slice(2, 4);
          const isSquareInFacts =
            facts.newly_undefended_own_pieces.some((p) => p.square === squareStr) ||
            facts.newly_undefended_enemy_pieces.some((p) => p.square === squareStr) ||
            playedTo === squareStr ||
            playedFrom === squareStr;

          if (!isSquareInFacts && !context.played.captured) {
            return {
              isValid: false,
              reason: `Affirmation de pièce menacée ou attaquée sur la case ${squareStr} absente des faits tactiques certifiés.`,
            };
          }
        }
      }
    }

    // G3 : Contrôle géométrique de menace directe (« pièce A menace pièce B »)
    const threatRegex =
      /\b(?:(votre|mon|notre|ce|cette|le|la)\s+)?(tour|cavalier|fou|dame|roi|pion)(\s+adverse)?\s+(?:menace|attaque)\s+(?:le|la|l'|les)?\s*(tour|cavalier|fou|dame|roi|pion)\b/i;
    const threatMatch = norm.match(threatRegex);
    if (threatMatch && fenAfter && !threatMatch[3]) {
      const subjectRoleFr = threatMatch[2];
      const subjectRole = roleMap[subjectRoleFr];
      const targetRoleFr = threatMatch[4];
      const targetRole = roleMap[targetRoleFr];
      const oppColor: 'white' | 'black' = playerColor === 'white' ? 'black' : 'white';
      const playedTo = context.played.uci.slice(2, 4);
      const subjectMatchesPlayedPiece =
        subjectRole !== undefined && checkPieceExistsOnSquare(fenAfter, subjectRole, playedTo);

      if (
        subjectMatchesPlayedPiece &&
        targetRole &&
        !doesPieceAttackRole(fenAfter, playedTo, targetRole, oppColor)
      ) {
        return {
          isValid: false,
          reason: `Affirmation de menace inventée : la pièce jouée en ${playedTo} n'attaque aucun(e) ${targetRoleFr} adverse.`,
        };
      }
    }

    // 8. Contrôle de cohérence de couleur du camp qui a joué
    const playedColor = context.played.color;
    if (playedColor === 'white') {
      if (/\b(les noirs jouent|coup des noirs|les noirs ont joue)\b/i.test(norm)) {
        return {
          isValid: false,
          reason: 'Incohérence sur la couleur : mention des Noirs pour un coup joué par les Blancs.',
        };
      }
    } else {
      if (/\b(les blancs jouent|coup des blancs|les blancs ont joue)\b/i.test(norm)) {
        return {
          isValid: false,
          reason: 'Incohérence sur la couleur : mention des Blancs pour un coup joué par les Noirs.',
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Explication déterministe, COURTE, sans notation, en français, avec le même
   * ton que le modèle. Objectif : **indiscernable** du rendu LLM.
   *
   * Couverture exhaustive des cas :
   *  - livraison d'un mat (mat joué) ;
   *  - séquences de mat subi / perdu / prolongé ;
   *  - 9 classifications : book, brilliant, great, best, excellent, good,
   *    inaccuracy, mistake, blunder ;
   *  - avec ou sans meilleur coup, avec ou sans faits tactiques vérifiés
   *    (pièce en prise, clouage, pion doublé), avec ou sans capture.
   *
   * Rien n'est inventé : chaque phrase s'appuie sur `verdict`, `best`,
   * `tactical_facts` ou la description de `MoveNarrator`.
   */
  public static fallbackCard(context: ExplanationContext, level: PlayerLevel): CoachCard {
    const { played, best, verdict, context: moveCtx } = context;
    const classification = verdict.classification;

    const playedDesc = describeMove(context.fen_before, played.uci);
    const playedText = playedDesc ? playedDesc.text : describePlayedFromContext(played);

    const bestDesc = best?.uci ? describeMove(context.fen_before, best.uci) : null;
    const bestAction = bestDesc
      ? `Le bon coup était : ${lowerFirst(bestDesc.text)}`
      : 'Cherchez un coup qui garde vos pièces protégées.';

    const isError =
      classification === 'inaccuracy' || classification === 'mistake' || classification === 'blunder';

    const insights: Insight[] = [];

    // ---- 1. Mat livré (le joueur vient de mater) ---------------------------
    if (played.is_mate) {
      return applyMoodLimits({
        headline: 'Échec et mat !',
        insights: [{ kind: 'played_move', text: playedText.replace(' Le roi est en échec.', '') }],
        takeaway: 'Bravo, la partie est gagnée.',
        level,
      }, context);
    }

    // ---- 2. Séquences de mat ------------------------------------------------
    if (moveCtx.mate_sequence === 'created') {
      return applyMoodLimits({
        headline: 'Attention : le mat menace',
        insights: [
          { kind: 'mistake', text: 'Votre roi va se faire mater.' },
          { kind: 'missed_move', text: bestAction },
        ],
        takeaway: 'Protégez votre roi avant de penser aux pièces.',
        level,
      }, context);
    }

    if (moveCtx.mate_sequence === 'lost') {
      return applyMoodLimits({
        headline: 'Vous aviez un mat',
        insights: [
          { kind: 'mistake', text: 'Ce coup laisse filer une victoire déjà prête.' },
          { kind: 'missed_move', text: bestAction },
        ],
        takeaway: 'Avant de jouer, vérifiez si vous pouvez mater tout de suite.',
        level,
      }, context);
    }

    if (moveCtx.mate_sequence === 'delayed') {
      return applyMoodLimits({
        headline: 'Le mat est encore là',
        insights: [{ kind: 'played_move', text: playedText }],
        takeaway: 'Tout va bien : le mat reste forcé, il arrive juste un peu plus tard.',
        level,
      }, context);
    }

    // ---- 3. Erreurs : problème prouvé, puis action -------------------------
    if (isError) {
      insights.push({ kind: 'mistake', text: describeProblem(context) });
      insights.push({ kind: 'missed_move', text: bestAction });

      return applyMoodLimits({
        headline: headlineFor(classification),
        insights,
        takeaway: takeawayFor(classification),
        level,
      }, context);
    }

    // ---- 4. Coups bons : valoriser ce qui est vérifiable -------------------
    insights.push({ kind: 'played_move', text: playedText });
    insights.push({ kind: 'good_decision', text: describeGood(context) });

    return applyMoodLimits({
      headline: headlineFor(classification),
      insights,
      takeaway: takeawayFor(classification),
      level,
    }, context);
  }
}

/**
 * Détecte une réponse majoritairement anglaise.
 *
 * Le prompt impose le français, mais un modèle peut dériver. On compare les
 * mots vides anglais et français : si l'anglais domine, la carte est écartée
 * au profit du fallback déterministe (français garanti).
 */
export function isFrenchText(text: string): boolean {
  const lower = text.toLowerCase();

  const frenchHits = (lower.match(
    /\b(le|la|les|des|une|un|et|est|vous|votre|vos|ce|cette|pour|avec|sur|dans|plus|pas|qui|que|au|aux|du|de|en|il|elle|on|ne|se|son|sa|ses|peut|être|avoir|bon|coup|pièce|roi|dame|tour|fou|cavalier|pion)\b/g
  ) ?? []).length;

  const englishHits = (lower.match(
    /\b(the|and|is|are|you|your|this|that|with|for|from|move|good|best|knight|bishop|rook|queen|pawn|king|capture|because|should|could|would|attack|defend|threat|position|game)\b/g
  ) ?? []).length;

  // Aucun marqueur d'aucune langue (phrase nominale) : on accepte.
  if (frenchHits === 0 && englishHits === 0) return true;

  return frenchHits >= englishHits;
}

// --- aides locales ----------------------------------------------------------

/** Titre selon le verdict, dans le registre émotionnel du cas. */
function headlineFor(classification: string): string {
  switch (classification) {
    case 'brilliant':
      return 'Bravo !';
    case 'great':
      return 'Très bon coup !';
    case 'best':
      return 'Le meilleur coup';
    case 'excellent':
      return 'Excellent choix';
    case 'book':
      return 'Ouverture connue';
    case 'good':
      return 'Bon coup';
    case 'inaccuracy':
      return 'Petite imprécision';
    case 'mistake':
      return 'Erreur';
    case 'blunder':
      return 'Pas de panique';
    default:
      return 'Coup joué';
  }
}

/** Conseil final, propre au cas. */
function takeawayFor(classification: string): string {
  switch (classification) {
    case 'brilliant':
      return 'Vous avez trouvé une très bonne idée, continuez à chercher ce genre de coup.';
    case 'great':
      return 'Vous jouez bien : gardez ce reflexe de chercher les coups actifs.';
    case 'best':
      return 'Continuez comme ça, vous ne laissez rien à l’adversaire.';
    case 'excellent':
      return 'Bonne décision, la position reste saine.';
    case 'book':
      return 'C’est une ouverture classique : vous êtes sur une bonne route.';
    case 'good':
      return 'Rien à corriger ici, votre position reste solide.';
    case 'inaccuracy':
      return 'Avant de jouer, vérifiez les prises possibles des deux camps.';
    case 'mistake':
      return 'Avant de jouer, regardez ce que l’adversaire menace sur votre camp.';
    case 'blunder':
      return 'Pas de panique : prenez le temps de vérifier les prises avant chaque coup.';
    default:
      return 'Continuez à vérifier vos pièces avant de jouer.';
  }
}

/**
 * Décrit le PROBLÈME de façon prouvée, par ordre de certitude :
 * pièce en prise → clouage → pion doublé → perte de matériel dans la variante
 * → perte d'évaluation. Jamais d'invention.
 */
function describeProblem(context: ExplanationContext): string {
  const { verdict, evaluation, tactical_facts: facts } = context;

  if (facts && facts.newly_undefended_own_pieces.length > 0) {
    const p = facts.newly_undefended_own_pieces[0];
    return `Votre ${p.piece} en ${p.square} peut être prise.`;
  }

  if (facts && facts.new_pins_against_player.length > 0) {
    const pin = facts.new_pins_against_player[0];
    return `Votre ${pin.pinned_piece} ne peut plus bouger sans perdre du matériel.`;
  }

  if (facts && facts.positional_changes.doubled_pawns_created.length > 0) {
    return 'Vos pions sont doublés et plus difficiles à défendre.';
  }

  if (facts && facts.material_delta_in_pv < 0) {
    const lost = Math.abs(facts.material_delta_in_pv);
    return `Vous perdez environ ${lost} point${lost > 1 ? 's' : ''} de matériel.`;
  }

  if (evaluation.player_loss_cp !== null && evaluation.player_loss_cp >= 100) {
    const pawns = (evaluation.player_loss_cp / 100).toFixed(1);
    return `Ce coup vous coûte environ ${pawns} pion d’avantage.`;
  }

  // Dernier recours : le verdict lui-même, sans chiffre inventé.
  return verdict.classification === 'inaccuracy'
    ? 'Ce coup est un peu moins bon que le meilleur.'
    : 'Ce coup affaiblit votre position.';
}

/**
 * Valorise un bon coup avec un fait vérifiable, sinon avec une formule sûre.
 */
function describeGood(context: ExplanationContext): string {
  const { played, tactical_facts: facts } = context;

  if (facts && facts.new_pins_by_player.length > 0) {
    const pin = facts.new_pins_by_player[0];
    return `Votre coup bloque le ${pin.pinned_piece} adverse.`;
  }

  if (facts && facts.newly_undefended_enemy_pieces.length > 0) {
    const target = facts.newly_undefended_enemy_pieces[0];
    return `Vous menacez le ${target.piece} adverse en ${target.square}.`;
  }

  if (played.captured) {
    return 'Vous gagnez du matériel sans rien laisser en retour.';
  }

  return 'Vous ne laissez aucune pièce sans défense.';
}


/**
 * Registre émotionnel PAR CAS. La consigne exige une émotion adaptée :
 * on célèbre un coup brillant, on rassure sur une gaffe, on alerte sur un mat.
 * Aucun emoji : le ton passe par les mots.
 */
interface Mood {
  tone: string;
  maxInsights: number;
  maxWordsPerInsight: number;
  maxHeadlineWords: number;
  maxTakeawayWords: number;
}

const MOODS: Record<string, Mood> = {
  brilliant: {
    tone: "Le coup est BRILLANT. Félicite franchement (« Bravo ! », « Magnifique ! ») en une phrase. Souligne l'idée forte du coup.",
    maxInsights: 1,
    maxWordsPerInsight: 30,
    maxHeadlineWords: 12,
    maxTakeawayWords: 30,
  },
  great: {
    tone: 'Très bon coup. Encourage chaleureusement, valorise le choix du joueur.',
    maxInsights: 1,
    maxWordsPerInsight: 30,
    maxHeadlineWords: 12,
    maxTakeawayWords: 30,
  },
  best: {
    tone: "C'est le meilleur coup possible. Valide sobrement (« C'est le meilleur coup »), sans enthousiasme excessif.",
    maxInsights: 1,
    maxWordsPerInsight: 30,
    maxHeadlineWords: 12,
    maxTakeawayWords: 30,
  },
  excellent: {
    tone: 'Coup très correct. Encourage brièvement.',
    maxInsights: 1,
    maxWordsPerInsight: 30,
    maxHeadlineWords: 12,
    maxTakeawayWords: 30,
  },
  good: {
    tone: 'Coup correct. Reste neutre et bref.',
    maxInsights: 1,
    maxWordsPerInsight: 30,
    maxHeadlineWords: 12,
    maxTakeawayWords: 30,
  },
  book: {
    tone: "Coup de théorie (ouverture connue). Rassure : « c'est une ouverture classique, vous êtes bien ».",
    maxInsights: 1,
    maxWordsPerInsight: 30,
    maxHeadlineWords: 12,
    maxTakeawayWords: 30,
  },
  inaccuracy: {
    tone: "Petite imprécision. Signale-le doucement, sans dramatiser, et donne l'action.",
    maxInsights: 2,
    maxWordsPerInsight: 30,
    maxHeadlineWords: 12,
    maxTakeawayWords: 30,
  },
  mistake: {
    tone: "Erreur réelle. Sois ferme mais bienveillant : nomme le problème, puis la correction.",
    maxInsights: 2,
    maxWordsPerInsight: 30,
    maxHeadlineWords: 12,
    maxTakeawayWords: 30,
  },
  blunder: {
    tone: "Grosse erreur. AUCUN reproche, aucune dramatisation : rassure (« pas de panique »), puis donne la correction à jouer.",
    maxInsights: 2,
    maxWordsPerInsight: 30,
    maxHeadlineWords: 12,
    maxTakeawayWords: 30,
  },
  mate_created: {
    tone: 'Le joueur va se faire mater. Ton grave mais calme, sans fatalisme : explique la menace simplement.',
    maxInsights: 2,
    maxWordsPerInsight: 30,
    maxHeadlineWords: 12,
    maxTakeawayWords: 30,
  },
  mate_lost: {
    tone: "Le joueur avait un mat et l'a laissé filer. Ton déçu mais pas accablant ; rappelle qu'il reste peut-être gagnant.",
    maxInsights: 2,
    maxWordsPerInsight: 30,
    maxHeadlineWords: 12,
    maxTakeawayWords: 30,
  },
};

const DEFAULT_MOOD: Mood = {
  tone: 'Ton neutre et encourageant.',
  maxInsights: 1,
  maxWordsPerInsight: 30,
  maxHeadlineWords: 12,
  maxTakeawayWords: 30,
};

/** Sélectionne le registre : séquence de mat prioritaire, sinon verdict. */
function moodFor(context: ExplanationContext): Mood {
  const mate = context.context.mate_sequence;
  if (mate === 'created') return MOODS.mate_created;
  if (mate === 'lost') return MOODS.mate_lost;
  return MOODS[context.verdict.classification] ?? DEFAULT_MOOD;
}

/** Extrait un tableau de chaînes d'une réponse modèle (tolère fences). */
function parseStringArray(raw: string): string[] | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const data: unknown = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(data)) return null;
    return data.filter((v): v is string => typeof v === 'string');
  } catch {
    return null;
  }
}

/** Notation brute : SAN (Nf3, Bxc5) ou UCI (e2e4, e7e8q). */
const RAW_SAN = /\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]\b/;
const RAW_UCI = /\b[a-h][1-8][a-h][1-8][qrbn]?\b/;

/**
 * Nettoie une phrase de démonstration : coupe la longueur, retire la notation.
 * Retourne `null` si la phrase devient inutilisable (le repli déterministe
 * prend alors le relais).
 */
export function sanitizeCaption(text: string, maxChars = 110): string | null {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  if (RAW_SAN.test(trimmed) || RAW_UCI.test(trimmed)) return null;

  // Une seule phrase : on coupe à la première ponctuation finale.
  const firstSentence = trimmed.split(/(?<=[.!?])\s+/)[0] ?? trimmed;
  const out = firstSentence.length > maxChars ? `${firstSentence.slice(0, maxChars - 1).trimEnd()}…` : firstSentence;
  return out.length >= 3 ? out : null;
}

/** Tronque proprement à N mots (ajoute « … » si coupé). */
function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(' ')}…`;
}

/**
 * Applique les bornes du registre émotionnel à une carte, quelle que soit son
 * origine (modèle ou repli local). C'est la garantie « ne dépasse pas la
 * longueur fournie » : le prompt la demande, le code l'impose.
 */
function applyMoodLimits(card: CoachCard, context: ExplanationContext): CoachCard {
  const max = moodFor(context);
  return {
    ...card,
    headline: truncateWords(card.headline, max.maxHeadlineWords),
    insights: card.insights
      .slice(0, max.maxInsights)
      .map(i => ({ ...i, text: truncateWords(i.text, max.maxWordsPerInsight) })),
    takeaway: truncateWords(card.takeaway, max.maxTakeawayWords),
  };
}

function describePiece(piece?: string): string {
  if (!piece) return 'une pièce';
  const article = ['tour', 'dame'].includes(piece) ? 'la' : 'le';
  return `${article} ${piece}`;
}

/**
 * Repli quand la position n'a pas pu être relue : on utilise les faits déjà
 * extraits (pièce déplacée, prise, échec) pour rester compréhensible.
 */
function describePlayedFromContext(played: {
  piece?: string;
  captured?: string | null;
  is_check: boolean;
  color: 'white' | 'black';
}): string {
  // « une pièce » (cas inconnu) doit rester grammaticalement correct.
  const raw = played.piece ? describePiece(played.piece) : 'une pièce';
  const piece = raw.replace(/^(le|la|une) /, '');

  let text: string;
  if (played.captured) {
    const captured = played.captured.startsWith('pion')
      ? played.captured
      : `${['tour', 'dame'].includes(played.captured) ? 'la' : 'le'} ${played.captured}`;
    text = `Votre ${piece} prend ${captured}.`;
  } else if (played.piece) {
    text = `Votre ${piece} change de case.`;
  } else {
    text = 'Votre pièce change de case.';
  }
  if (played.is_check) text += ' Le roi est en échec.';
  return text;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
