import { RiverAPI } from './RiverAPI';
import { uciToSan, pvToSan } from '../utils/san';
import {
  buildExplanationContext,
  pieceToFr,
  type CoachCard,
  type CoachDeepDive,
  type CoachDeepDiveSection,
  type ExplanationContext,
  type Insight,
  type PlayerLevel,
  type VerifiedTacticalFacts,
} from './ExplanationContext';
import { MotifEngine } from './MotifEngine';
import { describeMove } from './MoveNarrator';
import type { MoveRecord } from './types';

export const INITIAL_CARD_MAX_WORDS = 65;

/** Compte le nombre de mots d'un texte (utile pour appliquer le plafond de 65 mots). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

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
Tu es ChessCoach, entraîneur d'échecs pédagogique et factuel. Tu traduis une analyse déjà calculée (Stockfish + Lichess + faits géométriques vérifiés) sans jamais rien inventer.

# Principe directeur (Niveau 1 : Réponse initiale)
Dire l'essentiel immédiatement : 3 blocs complémentaires et sans répétition :
- headline : titre très court (2 à 6 mots).
- idea (BLOC 1 — L'IDÉE) : pourquoi le coup est intéressant ou pose problème, et ce qu'il change concrètement ici.
- objective (BLOC 2 — VOTRE OBJECTIF) : ce que le joueur qui a joué ce coup (played.color) doit chercher à accomplir ensuite (ou aurait dû jouer si le coup est une erreur, sans jamais lui conseiller le coup adverse refutation_pv_san).
- takeaway (BLOC 3 — À RETENIR) : un principe échiquéen simple, utile et réutilisable dans d'autres parties.

# Limite stricte : 65 mots MAXIMUM
- Le total cumulé des 3 blocs (idea + objective + takeaway) ne doit JAMAIS dépasser 65 mots (hors titres).
- Aucune répétition entre les blocs, aucun remplissage, aucun conseil générique.

# Règles de rédaction & preuves
- N'écris jamais une notation brute seule : ni « Nf3 », ni « Bxc6 », ni « a4 », ni « e2e4 ».
- Nomme la pièce en français (pion, cavalier, fou, tour, dame, roi) et sa case (« le cavalier va en f3 »).
- Évite le jargon chiffré (« centipawn »).
- Le JSON fourni est la seule source : n'invente jamais une pièce en prise, un clouage (n'emploie « clouage » / « cloué » que si tactical_facts.new_pins_* n'est pas vide ; ex. sur Fou en b5 face au pion d7, le cavalier c6 n'est PAS cloué), une fourchette ou une variante absents.
- Si opening.is_theory_move est vrai, ne présente jamais le coup comme une erreur.
- Séquences de mat : created → « le mat menace » ; lost → « un mat a été manqué » ; delayed → le mat reste forcé.

# Langue
Réponds EXCLUSIVEMENT en français naturel et fluide, en VOUVOYANT le joueur (« vous », « votre »), jamais « tu » ni « ton ». Écris « pièce » (jamais « morceau ») et « colonne e » (jamais « file »).
Les clés JSON restent en anglais (headline, idea, objective, takeaway).

# Format
Réponds UNIQUEMENT par un objet JSON valide (sans balise <think>, ni texte avant ou après) :
{"headline":"...","idea":"...","objective":"...","takeaway":"..."}`;

  private static readonly DEEP_DIVE_SYSTEM_PROMPT = `# Rôle
Tu es ChessCoach en mode APPROFONDISSEMENT (Niveau 2). Le joueur a déjà lu l'explication courte initiale et clique sur « Approfondir » pour vraiment comprendre la position.

# Mission pédagogique
Produis une véritable analyse complémentaire : NE RÉPÈTE PAS ni ne paraphrase les trois phrases initiales déjà affichées.
Sélectionne uniquement les dimensions pertinentes pour ce coup parmi :
1. Logique échiquéenne précise et relations de cause à effet (pourquoi l'idée fonctionne ou échoue).
2. Conséquences concrètes sur la position (activité, cases faibles, structure, sécurité du roi).
3. Idées stratégiques et tactiques pertinentes, menaces et ressources de l'adversaire.
4. Comparaison avec la meilleure alternative calculée lorsqu'elle apporte de la valeur.
5. Variantes importantes uniquement si disponibles dans le JSON (en français clair, sans jamais inventer de coups).
6. Erreurs de raisonnement possibles et plans à envisager ensuite.

# Règles strictes de fiabilité
- Le JSON fourni est la SEULE vérité : n'invente AUCUNE variante, AUCUNE menace fictive, AUCUN coup non calculé, AUCUNE pièce ou case absente.
- Dans « sections », ne décris QUE les pièces réellement présentes sur l'échiquier et les coups présents dans « pv_san » ou « refutation_pv_san » ; ne cite pas de coups futurs hypothétiques hors JSON (ex. pas de « fou en c4 » si aucun fou n'y va dans le JSON).
- Ne confonds jamais qualité du coup et statut théorique.
- N'écris JAMAIS les mots anglais « White » ou « Black » : écris toujours « les Blancs » et « les Noirs ».
- N'écris pas de notation brute seule (ni « Nf3 », ni « ...d5 », ni « e2e4 ») : nomme toujours la pièce en français et la case (« le cavalier en f3 », « pousser le pion en d5 »).
- Adapte la précision des concepts au niveau du joueur (debutant / intermediaire / avance).
- Structure claire et sans répétition ni longs paragraphes artificiels.

# Langue et format
Français exclusif, vouvoiement (« vous », « votre »). Écris « pièce » (jamais « morceau ») et « colonne » (jamais « file »).
Réponds UNIQUEMENT par un objet JSON valide (sans balise <think>, ni texte autour) :
{"summary":"Synthèse causale complémentaire en 1 phrase","sections":[{"title":"...","content":"..."}],"variants":["Suite vérifiée en français clair si pertinente"]}`;

  /**
   * Budget LLM par session (P1-9). Compteur statique : une session =
   * un chargement de page. Au-delà du budget, on bascule sur le fallback
   * SANS consommer de quota : un import PGN de 80 coups ne doit pas
   * déclencher 80 appels LLM ruinant la clé API.
   */
  private static llmCallsThisSession = 0;
  private static readonly LLM_SESSION_BUDGET = 200;

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

    // P1-9 : le budget est vérifié AVANT l'appel (barrière) mais consommé
    // SEULEMENT après un appel réussi. Un échec réseau ne gaspille pas le
    // budget — et 200 appels couvrent 100 coups × 2 (carte + démo).
    if (this.llmCallsThisSession >= this.LLM_SESSION_BUDGET) {
      const local = this.fallbackCard(context, level);
      return { ...local, degraded: true, source: 'fallback' };
    }

    try {
      const raw = await RiverAPI.complete(this.buildPrompt(context, level), this.SYSTEM_PROMPT, {
        temperature: 0.3,
        maxTokens: 1400,
      });

      // Vérifier que RiverAPI n'a pas retourné un message d'erreur simulé
      if (raw.startsWith('Le coach') || raw.startsWith('Impossible') || raw.startsWith('Analyse non disponible')) {
        console.info('[ExplanationEngine] Passerelle LLM indisponible, bascule sur la fiche pédagogique déterministe (mode dégradé).');
        const local = this.fallbackCard(context, level);
        return { ...local, degraded: true, source: 'fallback' };
      }

      const parsed = this.parseCard(raw);
      const parsedText = parsed
        ? [parsed.headline, parsed.idea ?? '', parsed.objective ?? '', parsed.takeaway, ...parsed.insights.map(i => i.text)].join(' ')
        : '';

      if (parsed && isFrenchText(parsedText)) {
        // P0.1 : Contrôle de cohérence factuelle avec VerifiedTacticalFacts
        const consistency = ExplanationEngine.verifyCardFactualConsistency(parsed, context.tactical_facts, context);
        if (consistency.isValid) {
          // Consomme le budget UNIQUEMENT sur succès (un coup = un appel réussi).
          this.llmCallsThisSession++;
          // Le prompt demande la brièveté ; le code la GARANTIT (max 65 mots réunis).
          return applyMoodLimits({ ...parsed, level, source: 'llm' }, context);
        }
        console.warn(`[ExplanationEngine] Fiche LLM rejetée pour incohérence factuelle (${consistency.reason}), bascule sur fallback local.`);
      } else {
        // Réponse non française ou unparseable : fallback avec badge.
        console.warn('[ExplanationEngine] Réponse LLM invalide ou non française, fallback local avec badge.');
      }

      const local = this.fallbackCard(context, level);
      return { ...local, degraded: true, source: 'fallback' };
    } catch (error) {
      // LLM indisponible (clé expirée, réseau, timeout) : fallback + badge.
      console.error('[ExplanationEngine] LLM indisponible, fallback local avec badge:', error);
      const local = this.fallbackCard(context, level);
      return { ...local, degraded: true, source: 'fallback' };
    }
  }

  /**
   * Niveau 2 (« Approfondir ») : génère une analyse pédagogique complémentaire
   * à la demande, en s'appuyant sur le contexte complet et la réponse initiale.
   */
  public static async generateDeepDive(
    record: MoveRecord,
    initialCard: CoachCard,
    level: PlayerLevel = 'intermediaire',
    previousClassification?: string | null
  ): Promise<CoachDeepDive> {
    const context = this.buildContext(record, previousClassification);

    if (this.llmCallsThisSession >= this.LLM_SESSION_BUDGET) {
      return { ...this.fallbackDeepDive(context, initialCard, level), degraded: true, source: 'fallback' };
    }

    try {
      const raw = await RiverAPI.complete(
        this.buildDeepDivePrompt(context, initialCard, level),
        this.DEEP_DIVE_SYSTEM_PROMPT,
        {
          temperature: 0.35,
          maxTokens: 1600,
        }
      );

      if (raw.startsWith('Le coach') || raw.startsWith('Impossible') || raw.startsWith('Analyse non disponible')) {
        console.info('[ExplanationEngine] Passerelle LLM indisponible pour Approfondir, bascule déterministe.');
        return { ...this.fallbackDeepDive(context, initialCard, level), degraded: true, source: 'fallback' };
      }

      const parsed = this.parseDeepDive(raw);
      const fullDeepText = parsed
        ? [
            parsed.summary ?? '',
            ...parsed.sections.flatMap(s => [s.title, s.content]),
            ...(parsed.variants ?? []),
          ].join(' ')
        : '';

      if (parsed && isFrenchText(fullDeepText)) {
        const consistency = ExplanationEngine.verifyDeepDiveFactualConsistency(
          parsed,
          context.tactical_facts,
          context
        );
        if (consistency.isValid) {
          this.llmCallsThisSession++;
          return { ...parsed, level, source: 'llm' };
        }
        console.warn(`[ExplanationEngine] Approfondissement LLM rejeté (${consistency.reason}), bascule déterministe.`);
      } else {
        console.warn('[ExplanationEngine] Approfondissement LLM invalide ou non français, bascule déterministe.');
      }

      return { ...this.fallbackDeepDive(context, initialCard, level), degraded: true, source: 'fallback' };
    } catch (error) {
      console.error('[ExplanationEngine] Approfondissement LLM indisponible, repli local:', error);
      return { ...this.fallbackDeepDive(context, initialCard, level), degraded: true, source: 'fallback' };
    }
  }

  /** Génère immédiatement une fiche pédagogique déterministe sans appel réseau. */
  public static buildLocalCard(
    record: MoveRecord,
    level: PlayerLevel = 'intermediaire',
    previousClassification?: string | null
  ): CoachCard {
    const context = this.buildContext(record, previousClassification);
    return { ...this.fallbackCard(context, level), source: 'local' };
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
        "Niveau du joueur : débutant. Phrases très courtes, concrètes, sans jargon technique.",
      intermediaire:
        "Niveau du joueur : intermédiaire. Nomme les motifs tactiques utiles (fourchette, clouage, développement, sécurité du roi) sans délayage.",
      avance:
        "Niveau du joueur : avancé. Analyse stratégique et tactique précise (plans, activité, cases faibles, initiative) tout en restant ultra-concis.",
    };

    const mood = moodFor(context);
    const guidance = resolveMoveGuidance(context);

    return `${levelInstructions[level]}

# Adaptation au type de coup (${guidance.label})
- Axe principal attendu pour la réponse initiale : ${guidance.initialFocus}
- Registre : ${mood.tone}

# Structure stricte en 3 blocs (MAXIMUM 65 mots réunis hors titres)
- headline : titre bref (2 à 6 mots).
- idea (BLOC 1 — L'IDÉE) : pourquoi le coup est intéressant ou pose problème ici (16 à 22 mots max).
- objective (BLOC 2 — VOTRE OBJECTIF) : ce que vous devez chercher à accomplir ensuite dans cette position (14 à 18 mots max).
- takeaway (BLOC 3 — À RETENIR) : principe échiquéen simple et réutilisable (10 à 14 mots max).
- Aucune répétition entre les blocs. Fais des phrases complètes et courtes : total (idea + objective + takeaway) ≤ ${INITIAL_CARD_MAX_WORDS} mots (vise ~45 à 55 mots pour ne pas être coupé).

# Langue et adresse
- EXCLUSIVEMENT en français, vouvoiement (« vous », « votre »).
- Aucune notation brute seule (« Nf3 », « e2e4 », « Bxc5 »). Pas de liste à puces.
- Ne raconte pas les variantes coup par coup dans la réponse initiale.

Dossier d'analyse (JSON) :
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

Écris uniquement l'objet JSON demandé.`;
  }

  private static buildDeepDivePrompt(
    context: ExplanationContext,
    initialCard: CoachCard,
    level: PlayerLevel
  ): string {
    const levelInstructions: Record<PlayerLevel, string> = {
      debutant:
        "Niveau du joueur : débutant. Explique les relations de cause à effet simplement, avec des termes clairs et sans jargon superflu.",
      intermediaire:
        "Niveau du joueur : intermédiaire. Détaille les motifs tactiques, les faiblesses, la sécurité du roi et l'activité des pièces.",
      avance:
        "Niveau du joueur : avancé. Propose une analyse positionnelle et dynamique approfondie (plans à moyen terme, déséquilibres, prophylaxie, calcul concret).",
    };

    const guidance = resolveMoveGuidance(context);
    const initialSummary = {
      headline: initialCard.headline,
      idea: initialCard.idea ?? initialCard.insights[0]?.text ?? '',
      objective: initialCard.objective ?? initialCard.insights[1]?.text ?? '',
      takeaway: initialCard.takeaway,
    };

    return `${levelInstructions[level]}

# Adaptation au type de coup (${guidance.label})
- Focus demandé pour l'approfondissement : ${guidance.deepDiveFocus}
${guidance.tacticalNote ? `- Élément tactique/défensif détecté : ${guidance.tacticalNote}` : ''}

# Réponse initiale déjà affichée (NE PAS RÉPÉTER NI PARAPHRASER)
\`\`\`json
${JSON.stringify(initialSummary, null, 2)}
\`\`\`

# Ce que l'approfondissement doit apporter (sélectionner uniquement ce qui est pertinent ici)
1. Logique échiquéenne précise et enchaînement cause → conséquence du coup joué.
2. Conséquences concrètes sur la position (développement, structure de pions, cases faibles, sécurité du roi).
3. Menaces et ressources réelles de l'adversaire (appuyées sur tactical_facts et refutation_pv_san si présents).
4. Comparaison précise avec la meilleure alternative (context.best) lorsqu'elle est différente.
5. Variantes calculées importantes uniquement si présentes dans context.best.pv_san ou tactical_facts.refutation_pv_san (sans jamais en inventer d'autres).
6. Pièges de raisonnement possibles et plans à envisager pour la suite.

# Contraintes
- 2 à 4 sections claires maximum, concises et riches en explications causales (pas de blabla ni remplissage).
- Exclusivement en français, vouvoiement (« vous », « votre »), sans notation brute isolée (décris les coups avec le nom de la pièce en français et sa case).
- N'affirme jamais une pièce en prise, un clouage, une fourchette ou un mat absents du dossier JSON.

Dossier complet d'analyse (JSON) :
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

Réponds uniquement par l'objet JSON : {"summary":"...","sections":[{"title":"...","content":"..."}],"variants":[...]}`;
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

    // C6 : les démos consomment aussi le budget, mais APRÈS l'appel réussi
    // (pas avant, sinon un échec gaspille un slot). Le compteur est partagé
    // avec generateCard : 200 appels couvrent 100 coups × 2 (card + démo).

    try {
      const raw = await RiverAPI.complete(
        this.buildDemoPrompt(startFen, uciMoves, kind),
        'Tu es un coach d’échecs pour débutants. Tu réponds uniquement par un tableau JSON de phrases courtes.',
        { temperature: 0.4, maxTokens: 700 }
      );

      // Consomme le budget sur succès uniquement.
      this.llmCallsThisSession++;

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

  /** Extrait un objet JSON nettoyé depuis une réponse modèle (tolère fences). */
  private static extractJsonObject(raw: string): Record<string, unknown> | null {
    if (!raw) return null;
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;

    try {
      const data: unknown = JSON.parse(cleaned.slice(start, end + 1));
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      return data as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Parse la réponse initiale (supporte le format 3 blocs et l'ancien format insights). */
  public static parseCard(raw: string): Omit<CoachCard, 'level'> | null {
    const obj = this.extractJsonObject(raw);
    if (!obj) return null;

    const headline = typeof obj.headline === 'string' ? obj.headline.trim() : '';
    const idea = typeof obj.idea === 'string' ? obj.idea.trim() : '';
    const objective = typeof obj.objective === 'string' ? obj.objective.trim() : '';
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

    if (insights.length === 0) {
      if (idea) insights.push({ kind: 'played_move', text: idea });
      if (objective) insights.push({ kind: 'good_decision', text: objective });
    }

    if (headline.length === 0 && insights.length === 0 && !idea && !objective && takeaway.length === 0) {
      return null;
    }

    return {
      headline,
      idea: idea || insights[0]?.text || undefined,
      objective: objective || insights[1]?.text || undefined,
      insights,
      takeaway,
    };
  }

  /** Parse la réponse JSON d'approfondissement (Niveau 2 : « Approfondir »). */
  public static parseDeepDive(raw: string): Omit<CoachDeepDive, 'level'> | null {
    const obj = this.extractJsonObject(raw);
    if (!obj) return null;

    const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
    const rawSections = Array.isArray(obj.sections) ? obj.sections : [];
    const sections: CoachDeepDiveSection[] = [];
    for (const item of rawSections) {
      if (!item || typeof item !== 'object') continue;
      const sec = item as Record<string, unknown>;
      const title = typeof sec.title === 'string' ? sec.title.trim() : '';
      const content = typeof sec.content === 'string' ? sec.content.trim() : '';
      if (title.length > 0 && content.length > 0) {
        sections.push({ title, content });
      }
    }

    const rawVariants = Array.isArray(obj.variants) ? obj.variants : [];
    const variants = rawVariants
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map(v => v.trim());

    if (sections.length === 0 && !summary) return null;

    return {
      summary: summary || undefined,
      sections,
      variants: variants.length > 0 ? variants : undefined,
    };
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
      card.idea ?? '',
      card.objective ?? '',
      card.takeaway,
      ...card.insights.map((i) => i.text),
    ].join(' ');

    return this.verifyTextFactualConsistency(fullText, facts, context);
  }

  /**
   * Valide une réponse d'approfondissement (Niveau 2) avec les mêmes 8 contrôles
   * factuels ET la vérification sur l'échiquier des variantes éventuellement citées.
   */
  public static verifyDeepDiveFactualConsistency(
    deepDive: Omit<CoachDeepDive, 'level'> | CoachDeepDive,
    facts: VerifiedTacticalFacts | undefined,
    context: ExplanationContext
  ): { isValid: boolean; reason?: string } {
    if (!deepDive.sections || deepDive.sections.length === 0) {
      return { isValid: false, reason: 'Approfondissement vide (aucune section structurée).' };
    }

    const fullText = [
      deepDive.summary ?? '',
      ...deepDive.sections.flatMap(s => [s.title, s.content]),
      ...(deepDive.variants ?? []),
    ].join(' ');

    const textCheck = this.verifyTextFactualConsistency(fullText, facts, context, { isDeepDive: true });
    if (!textCheck.isValid) return textCheck;

    if (deepDive.variants && deepDive.variants.length > 0) {
      const variantCheck = this.validateVariantsOnBoard(deepDive.variants, context);
      if (!variantCheck.isValid) return variantCheck;
    }

    return { isValid: true };
  }

  /**
   * Vérifie que toute séquence de coups (SAN/UCI) citée dans `variants` est légale
   * sur l'échiquier à partir de `fen_before` / `fen_after` et appartient aux variantes calculées.
   */
  private static validateVariantsOnBoard(
    variants: string[],
    context: ExplanationContext
  ): { isValid: boolean; reason?: string } {
    const knownTokens = new Set<string>();
    const pushSan = (s?: string | null) => {
      if (s) knownTokens.add(s.replace(/[+#!?]+/g, '').toLowerCase());
    };
    pushSan(context.played.san);
    pushSan(context.best?.san);
    for (const m of context.best?.pv_san ?? []) pushSan(m);
    for (const m of context.tactical_facts?.refutation_pv_san ?? []) pushSan(m);

    const sanTokenRegex = /\b(?:O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?)\b/g;

    for (const line of variants) {
      const tokens = line.match(sanTokenRegex);
      if (!tokens || tokens.length === 0) continue;

      let simPos: Chess | null = null;
      let startChecked = false;
      try {
        const beforePos = Chess.fromSetup(parseFen(context.fen_before).unwrap()).unwrap();
        const afterFen = context.tactical_facts?.fen_after;
        const afterPos = afterFen ? Chess.fromSetup(parseFen(afterFen).unwrap()).unwrap() : null;
        const firstMoveBefore = parseSan(beforePos, tokens[0]);
        if (firstMoveBefore && beforePos.isLegal(firstMoveBefore)) {
          simPos = beforePos;
          startChecked = true;
        } else if (afterPos) {
          const firstMoveAfter = parseSan(afterPos, tokens[0]);
          if (firstMoveAfter && afterPos.isLegal(firstMoveAfter)) {
            simPos = afterPos;
            startChecked = true;
          }
        }
      } catch {
        simPos = null;
      }

      if (!startChecked || !simPos) {
        return {
          isValid: false,
          reason: `Variante illégale ou hors position détectée dans l'approfondissement (« ${tokens[0]} »).`,
        };
      }

      for (const tok of tokens) {
        const cleanTok = tok.replace(/[+#!?]+/g, '').toLowerCase();
        if (knownTokens.size > 0 && !knownTokens.has(cleanTok)) {
          return {
            isValid: false,
            reason: `Coup de variante non calculé (« ${tok} » absent des variantes Stockfish vérifiées).`,
          };
        }
        const parsedMove = parseSan(simPos, tok);
        if (!parsedMove || !simPos.isLegal(parsedMove)) {
          return {
            isValid: false,
            reason: `Variante illégale sur l'échiquier au coup « ${tok} ».`,
          };
        }
        simPos.play(parsedMove);
      }
    }

    return { isValid: true };
  }

  private static verifyTextFactualConsistency(
    fullText: string,
    facts: VerifiedTacticalFacts | undefined,
    context: ExplanationContext,
    options: { isDeepDive?: boolean } = {}
  ): { isValid: boolean; reason?: string } {
    const isDeepDive = options.isDeepDive === true;

    // Normalisation Unicode sans accents pour des détections fiables
    const norm = fullText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    // 1. Contrôle des affirmations de pièce en prise / indéfendue / non protégée
    // (on exclut les conseils préventifs généraux et les négations explicites)
    const normForHanging = norm
      .replace(
        /\b(?:pour\s+)?(?:eviter|evitez|ne pas|jamais)\s+(?:de\s+)?(?:laisser|exposer|mettre)[^.!?]{0,60}/gi,
        ''
      )
      .replace(
        /\bsans\s+(?:laisser|mettre|rendre|exposer|qu['’](?:un|une|le|la|votre)[^.!?]{0,25}(?:soit|reste))\s+[^.!?]{0,40}(?:en prise|sans defense|non protegee?s?|indefendue?s?)/gi,
        ''
      )
      .replace(
        /\b(?:n['’](?:est|etait|y a|ont|avez)|ne\s+(?:laisse|laissez|met|mettez|reste|sont)|ni|pas|aucun(?:e)?)\s+(?:pas\s+|plus\s+)?(?:\w+\s+){0,2}?(?:de\s+|d['’])?(?:(?:piece|pion|cavalier|fou|tour|dame|roi)\s+)?(?:en\s+)?(?:[a-h][1-8]\s+)?(?:n['’]est\s+)?(?:\w+\s+){0,1}?(?:en prise|non protegee?s?|indefendue?s?|sans defense)\b/gi,
        ''
      );
    const hangingPattern = isDeepDive
      ? /\b(en prise|non protegee?s?|indefendue?s?|sans defense|laisse (?:une|votre|la) piece)\b/i
      : /\b(en prise|non protegee?s?|indefendue?s?|sans defense|peut etre pris[ee]?s?|laisse (?:une|votre|la) piece)\b/i;
    const claimsHanging = hangingPattern.test(normForHanging);

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
    const normForMate = norm
      .replace(
        /\b(?:sans|aucun(?:e)?|pas\s+de|eviter\s+(?:une?|le|la)?)\s+(?:de\s+)?(?:menace\s+de\s+mat|echec\s+et\s+mat|mat\s+(?:imminent|immediat|force|inevitable|imparable))\b/gi,
        ''
      )
      .replace(
        /\b(?:n['’](?:est|y a)|ne\s+(?:donne|livre|fait|cree|menace))\s+(?:pas|plus|aucun(?:e)?)\s+(?:d['’]|de\s+)?(?:echec\s+et\s+mat|mat|menace\s+de\s+mat)\b/gi,
        ''
      );
    const claimsMate =
      /\b(echec et mat|fait mat|livre mat|est mat\b|vous matez|mat inevitable|mat imparable|va vous mater|se faire mater|menace de mat)\b/i.test(normForMate);

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

    // Résolution FEN résultante (coup joué ET meilleur coup recommandé) pour contrôles géométriques stricts
    let fenAfter = context.tactical_facts?.fen_after;
    if (!fenAfter) {
      try {
        const setup = parseFen(context.fen_before).unwrap();
        const pos = Chess.fromSetup(setup).unwrap();
        const m = context.played.uci ? parseUci(context.played.uci) : undefined;
        if (m && pos.isLegal(m)) {
          pos.play(m);
          fenAfter = makeFen(pos.toSetup());
        }
      } catch {}
    }

    let fenAfterBest: string | undefined;
    if (context.best?.uci) {
      try {
        const setupBest = parseFen(context.fen_before).unwrap();
        const posBest = Chess.fromSetup(setupBest).unwrap();
        const bestMove = parseUci(context.best.uci);
        if (bestMove && posBest.isLegal(bestMove)) {
          posBest.play(bestMove);
          fenAfterBest = makeFen(posBest.toSetup());
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
    const pvFens: string[] = [];
    const pvTargetSquares = new Set<string>();
    const collectPvFens = (startFen: string | undefined, moves: string[] | undefined) => {
      if (!startFen || !moves || moves.length === 0) return;
      try {
        const pos = Chess.fromSetup(parseFen(startFen).unwrap()).unwrap();
        for (const san of moves.slice(0, 6)) {
          const mv = parseSan(pos, san);
          if (!mv || !pos.isLegal(mv)) break;
          if ('to' in mv) pvTargetSquares.add(makeSquare(mv.to));
          if ('from' in mv) pvTargetSquares.add(makeSquare(mv.from));
          pos.play(mv);
          pvFens.push(makeFen(pos.toSetup()));
        }
      } catch {}
    };
    collectPvFens(context.fen_before, context.best?.pv_san);
    collectPvFens(fenAfter, context.tactical_facts?.refutation_pv_san);

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
        const existsAfterBest = fenAfterBest
          ? checkPieceExistsOnSquare(fenAfterBest, expectedRole, squareStr)
          : false;
        const existsInPv = pvFens.some(f => checkPieceExistsOnSquare(f, expectedRole, squareStr));
        const beforeSlice = norm.slice(Math.max(0, match.index - 55), match.index);
        const isFutureMoveDestination =
          /\b(?:jouer|jouez|pousser|poussez|avancer|avancez|placer|placez|poster|postez|developper|developpez|amener|amenez|envoyer|envoyez|installer|installez|replier|repliez|mettre|mettez|porter|portez|aller|venir|reculer|reculez|revenir|revenez)\s+(?:ensuite\s+|egalement\s+|plutot\s+|avec\s+)?(?:un|une|le|la|votre|vos|son|leur|ce|cette|l['’]autre|autre)?\s*(?:autre\s+)?$/i.test(beforeSlice) ||
          (isDeepDive && /\b(?:sortie|developpement|placement|idee|option)\s+(?:d['’]un|d['’]une|du|de la)\s+$/i.test(beforeSlice));

        if (!existsBefore && !existsAfter && !existsAfterBest && !existsInPv && !isFutureMoveDestination) {
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
          const playedUci = context.played.uci ?? '';
          const bestUci = context.best?.uci ?? '';
          const playedFrom = playedUci.slice(0, 2);
          const playedTo = playedUci.slice(2, 4);
          const bestFrom = bestUci.slice(0, 2);
          const bestTo = bestUci.slice(2, 4);
          const isSquareInFacts =
            facts.newly_undefended_own_pieces.some((p) => p.square === squareStr) ||
            facts.newly_undefended_enemy_pieces.some((p) => p.square === squareStr) ||
            playedTo === squareStr ||
            playedFrom === squareStr ||
            bestTo === squareStr ||
            bestFrom === squareStr ||
            pvTargetSquares.has(squareStr) ||
            existsInPv ||
            existsAfterBest;

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
      const playedTo = (context.played.uci ?? '').slice(2, 4);
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
    // En Niveau 2 (Approfondissement), le coach décrit aussi les réponses adverses (« les Noirs jouent... »).
    const playedColor = context.played.color;
    if (playedColor === 'white') {
      const wrongAttr = isDeepDive
        ? /\b(coup des noirs|les noirs ont joue)\b/i
        : /\b(les noirs jouent|coup des noirs|les noirs ont joue)\b/i;
      if (wrongAttr.test(norm)) {
        return {
          isValid: false,
          reason: 'Incohérence sur la couleur : mention des Noirs pour un coup joué par les Blancs.',
        };
      }
    } else {
      const wrongAttr = isDeepDive
        ? /\b(coup des blancs|les blancs ont joue)\b/i
        : /\b(les blancs jouent|coup des blancs|les blancs ont joue)\b/i;
      if (wrongAttr.test(norm)) {
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

    const playedDesc = played.uci ? describeMove(context.fen_before, played.uci) : null;
    const playedText = playedDesc ? playedDesc.text : describePlayedFromContext(played);

    const bestDesc = best?.uci ? describeMove(context.fen_before, best.uci) : null;
    const bestAction = bestDesc
      ? `Le bon coup était : ${lowerFirst(bestDesc.text)}`
      : 'Cherchez un coup qui garde vos pièces protégées.';

    const isError =
      classification === 'inaccuracy' || classification === 'mistake' || classification === 'blunder';

    // ---- 1. Mat livré (le joueur vient de mater) ---------------------------
    if (played.is_mate) {
      const idea = playedText.replace(' Le roi est en échec.', '');
      const objective = 'La partie est terminée par échec et mat.';
      return applyMoodLimits({
        headline: 'Échec et mat !',
        idea,
        objective,
        insights: [{ kind: 'played_move', text: idea }],
        takeaway: 'Bravo, la partie est gagnée.',
        level,
      }, context);
    }

    // ---- 2. Séquences de mat ------------------------------------------------
    if (moveCtx.mate_sequence === 'created') {
      const idea = 'Votre roi va se faire mater.';
      return applyMoodLimits({
        headline: 'Attention : le mat menace',
        idea,
        objective: bestAction,
        insights: [
          { kind: 'mistake', text: idea },
          { kind: 'missed_move', text: bestAction },
        ],
        takeaway: 'Protégez votre roi avant de penser aux pièces.',
        level,
      }, context);
    }

    if (moveCtx.mate_sequence === 'lost') {
      const idea = 'Ce coup laisse filer une victoire déjà prête.';
      return applyMoodLimits({
        headline: 'Vous aviez un mat',
        idea,
        objective: bestAction,
        insights: [
          { kind: 'mistake', text: idea },
          { kind: 'missed_move', text: bestAction },
        ],
        takeaway: 'Avant de jouer, vérifiez si vous pouvez mater tout de suite.',
        level,
      }, context);
    }

    if (moveCtx.mate_sequence === 'delayed') {
      return applyMoodLimits({
        headline: 'Le mat est encore là',
        idea: playedText,
        objective: 'Maintenez la pression sur le roi adverse pour conclure.',
        insights: [{ kind: 'played_move', text: playedText }],
        takeaway: 'Tout va bien : le mat reste forcé, il arrive juste un peu plus tard.',
        level,
      }, context);
    }

    // ---- 3. Erreurs : problème prouvé, puis action -------------------------
    if (isError) {
      const problem = describeProblem(context);
      return applyMoodLimits({
        headline: headlineFor(classification),
        idea: problem,
        objective: bestAction,
        insights: [
          { kind: 'mistake', text: problem },
          { kind: 'missed_move', text: bestAction },
        ],
        takeaway: takeawayFor(classification),
        level,
      }, context);
    }

    // ---- 4. Coups bons / théoriques : idée et objectif positionnel --------
    const good = describeGood(context);
    return applyMoodLimits({
      headline: headlineFor(classification),
      idea: playedText,
      objective: good,
      insights: [
        { kind: 'played_move', text: playedText },
        { kind: 'good_decision', text: good },
      ],
      takeaway: takeawayFor(classification),
      level,
    }, context);
  }

  /**
   * Repli déterministe pour le Niveau 2 (« Approfondir ») : produit une analyse
   * causale structurée à partir des faits géométriques, du score Stockfish et
   * des variantes narrées en français clair sur l'échiquier.
   */
  public static fallbackDeepDive(
    context: ExplanationContext,
    initialCard: CoachCard,
    level: PlayerLevel
  ): CoachDeepDive {
    const { played, best, evaluation, tactical_facts: facts, opening, verdict } = context;
    const guidance = resolveMoveGuidance(context);
    const sections: CoachDeepDiveSection[] = [];

    // 1. Logique et conséquences concrètes sur l'évaluation et la structure
    const logicParts: string[] = [];
    if (evaluation.before !== null && evaluation.after !== null) {
      const beforePawns = (evaluation.before / 100).toFixed(1);
      const afterPawns = (evaluation.after / 100).toFixed(1);
      if (evaluation.player_loss_cp !== null && evaluation.player_loss_cp >= 50) {
        logicParts.push(
          `Ce coup fait évoluer l'évaluation de ${beforePawns} à ${afterPawns} pions, ce qui dégrade votre marge.`
        );
      } else {
        logicParts.push(
          `L'évaluation reste maîtrisée autour de ${afterPawns} pions après ce coup.`
        );
      }
    }

    if (opening?.is_theory_move && opening.name) {
      const freqPct = opening.frequency_percent !== null ? ` (${opening.frequency_percent} % des parties de maîtres)` : '';
      logicParts.push(
        `Dans l'ouverture « ${opening.name} »${freqPct}, ce coup suit les plans classiques de développement et de contrôle central.`
      );
    }

    if (facts) {
      const pos = facts.positional_changes;
      if (pos.doubled_pawns_created.length > 0) {
        logicParts.push('Votre structure crée des pions doublés, plus difficiles à défendre à long terme.');
      }
      if (pos.passed_pawns_created.length > 0) {
        logicParts.push('Vous obtenez un pion passé qui crée une pression durable.');
      }
      if (pos.open_files_near_king.length > 0) {
        logicParts.push('Une colonne s’ouvre près du roi, demandant une attention particulière à sa sécurité.');
      }
    }

    if (logicParts.length === 0) {
      logicParts.push(
        `Analyse (${guidance.label.toLowerCase()}) : ${guidance.deepDiveFocus.toLowerCase()}.`
      );
    }
    sections.push({ title: 'Logique et conséquences', content: logicParts.join(' ') });

    // 2. Menaces, tactiques et ressources adverses
    const threatParts: string[] = [];
    const definiteFr = (p: string): string => (p === 'dame' || p === 'tour' ? `la ${p}` : `le ${p}`);
    if (facts) {
      if (facts.newly_undefended_own_pieces.length > 0) {
        const own = facts.newly_undefended_own_pieces[0];
        threatParts.push(
          `Votre ${own.piece} en ${own.square} devient vulnérable et risque d'être sous attaque adverse.`
        );
      }
      if (facts.newly_undefended_enemy_pieces.length > 0) {
        const enemy = facts.newly_undefended_enemy_pieces[0];
        threatParts.push(
          `Vous mettez la pression sur ${definiteFr(enemy.piece)} adverse en ${enemy.square}.`
        );
      }
      if (facts.new_pins_against_player.length > 0) {
        const pin = facts.new_pins_against_player[0];
        threatParts.push(
          `Attention au clouage sur votre ${pin.pinned_piece} en ${pin.pinned_square}.`
        );
      }
      if (facts.new_pins_by_player.length > 0) {
        const pin = facts.new_pins_by_player[0];
        threatParts.push(
          `Votre coup cloue ${definiteFr(pin.pinned_piece)} adverse en ${pin.pinned_square}, limitant ses mouvements.`
        );
      }
    }

    if (threatParts.length === 0) {
      threatParts.push(
        verdict.classification === 'blunder' || verdict.classification === 'mistake'
          ? "L'adversaire peut exploiter l'initiative obtenue pour prendre le contrôle des cases clés."
          : "Aucune faiblesse tactique immédiate n'apparaît dans votre camp après ce coup."
      );
    }
    sections.push({ title: 'Menaces et ressources adverses', content: threatParts.join(' ') });

    // 3. Alternatives et suite calculée
    const bestDesc = best?.uci ? describeMove(context.fen_before, best.uci) : null;
    if (bestDesc && best?.uci !== played.uci) {
      sections.push({
        title: 'Meilleure alternative',
        content: `L'option la plus précise était : ${lowerFirst(bestDesc.text)} Elle évitait les concessions créées par le coup joué.`,
      });
    }

    // Variantes vérifiées narrées en français clair depuis l'échiquier
    const variants: string[] = [];
    if (best?.pv_san && best.pv_san.length > 0) {
      const narrated = narrateSanSequence(context.fen_before, best.pv_san.slice(0, 4));
      if (narrated) variants.push(`Suite recommandée : ${narrated}`);
    }
    if (facts && facts.refutation_pv_san.length > 0 && facts.fen_after) {
      const narratedRef = narrateSanSequence(facts.fen_after, facts.refutation_pv_san.slice(0, 4));
      if (narratedRef) variants.push(`Réponse adverse typique : ${narratedRef}`);
    }

    const summary =
      initialCard.headline && level === 'avance'
        ? `${guidance.deepDiveFocus} sur cette position.`
        : `${guidance.label} : approfondissement des conséquences concrètes sur l'échiquier.`;

    return {
      summary,
      sections,
      variants: variants.length > 0 ? variants : undefined,
      level,
      source: 'fallback',
    };
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

interface MoveGuidance {
  label: string;
  initialFocus: string;
  deepDiveFocus: string;
  tacticalNote?: string;
}

/** Table d'adaptation pédagogique (Spécification v1.1 — Section 4). */
function resolveMoveGuidance(context: ExplanationContext): MoveGuidance {
  const { classification } = context.verdict;
  const facts = context.tactical_facts;
  const isDefense =
    classification === 'best' &&
    context.evaluation.mate_before !== null &&
    context.evaluation.mate_before < 0;

  const hasTactic = Boolean(
    context.played.captured ||
    context.played.is_check ||
    context.played.is_mate ||
    (facts &&
      (facts.newly_undefended_own_pieces.length > 0 ||
        facts.newly_undefended_enemy_pieces.length > 0 ||
        facts.new_pins_against_player.length > 0 ||
        facts.new_pins_by_player.length > 0))
  );

  const tacticalNote = hasTactic
    ? 'Combinaison / motif tactique présent (détail et conséquences à expliquer)'
    : undefined;

  if (isDefense) {
    return {
      label: 'Coup défensif',
      initialFocus: 'Menace neutralisée',
      deepDiveFocus: 'Analyse des ressources défensives',
      tacticalNote,
    };
  }

  switch (classification) {
    case 'brilliant':
    case 'great':
      return {
        label: 'Excellent coup',
        initialFocus: 'Idée remarquable',
        deepDiveFocus: 'Analyse de la combinaison et de ses conséquences',
        tacticalNote,
      };
    case 'book':
      return {
        label: 'Coup théorique',
        initialFocus: "Idée de l'ouverture",
        deepDiveFocus: 'Logique de la variante et plans associés',
        tacticalNote,
      };
    case 'inaccuracy':
      return {
        label: 'Imprécision',
        initialFocus: 'Ce qui pouvait être mieux joué',
        deepDiveFocus: 'Analyse de la meilleure alternative',
        tacticalNote,
      };
    case 'mistake':
      return {
        label: 'Erreur',
        initialFocus: 'Problème principal',
        deepDiveFocus: 'Explication de la dégradation positionnelle',
        tacticalNote,
      };
    case 'blunder':
      return {
        label: 'Gaffe',
        initialFocus: 'Danger immédiat',
        deepDiveFocus: 'Tactique manquée et meilleure défense',
        tacticalNote,
      };
    default:
      return {
        label: hasTactic ? 'Coup tactique' : 'Bon coup',
        initialFocus: hasTactic ? 'Combinaison essentielle' : 'Intérêt et objectif',
        deepDiveFocus: hasTactic
          ? 'Déroulement détaillé et conséquences'
          : 'Justification stratégique',
        tacticalNote,
      };
  }
}

/** Décrit en français clair une courte séquence SAN vérifiée sur l'échiquier. */
function narrateSanSequence(startFen: string, pvSan: string[]): string {
  if (!pvSan || pvSan.length === 0) return '';
  try {
    const pos = Chess.fromSetup(parseFen(startFen).unwrap()).unwrap();
    const parts: string[] = [];
    for (const san of pvSan) {
      const m = parseSan(pos, san);
      if (!m || !pos.isLegal(m) || !('from' in m)) break;
      const uci = `${makeSquare(m.from)}${makeSquare(m.to)}${m.promotion ? m.promotion[0] : ''}`;
      const fenNow = makeFen(pos.toSetup());
      const desc = describeMove(fenNow, uci);
      if (desc) {
        parts.push(desc.text.replace(/\.$/, ''));
      }
      pos.play(m);
    }
    return parts.length > 0 ? `${parts.join(', puis ')}.` : '';
  } catch {
    return '';
  }
}

/** Tronque proprement à N mots (ajoute « … » si coupé). */
function truncateWords(text: string, maxWords: number): string {
  const trimmed = text.trim();
  if (!trimmed || maxWords <= 0) return '';
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) return trimmed;
  return `${words.slice(0, maxWords).join(' ')}…`;
}

/**
 * Répartit un plafond global de mots (65) sur les 3 blocs initiaux sans jamais
 * dépasser la limite totale.
 */
function enforceThreeBlockBudget(
  blocks: [string, string, string],
  maxTotalWords: number
): [string, string, string] {
  const counts = blocks.map(countWords);
  const total = counts[0] + counts[1] + counts[2];
  if (total <= maxTotalWords) return blocks;

  const budgets = [...counts];
  let excess = total - maxTotalWords;
  while (excess > 0) {
    // Réduit d'abord le bloc actuellement le plus long (> 1 mot)
    let longestIdx = -1;
    let longestLen = 1;
    for (let i = 0; i < 3; i++) {
      if (budgets[i] > longestLen) {
        longestLen = budgets[i];
        longestIdx = i;
      }
    }
    if (longestIdx === -1) break;
    budgets[longestIdx]--;
    excess--;
  }

  return [
    truncateWords(blocks[0], budgets[0]),
    truncateWords(blocks[1], budgets[1]),
    truncateWords(blocks[2], budgets[2]),
  ];
}

/**
 * Applique les bornes du registre et la limite stricte de 65 mots réunis
 * aux trois blocs de la réponse initiale (`idea`, `objective`, `takeaway`).
 */
function applyMoodLimits(card: CoachCard, context: ExplanationContext): CoachCard {
  const max = moodFor(context);
  const rawIdea = card.idea ?? card.insights[0]?.text ?? '';
  const rawObjective = card.objective ?? card.insights[1]?.text ?? '';
  const rawTakeaway = card.takeaway ?? '';

  const [idea, objective, takeaway] = enforceThreeBlockBudget(
    [rawIdea, rawObjective, rawTakeaway],
    INITIAL_CARD_MAX_WORDS
  );

  const syncedInsights: Insight[] = [];
  if (card.insights.length > 0) {
    if (idea) {
      syncedInsights.push({ ...card.insights[0], text: idea });
    }
    if (objective && card.insights.length > 1) {
      syncedInsights.push({ ...card.insights[1], text: objective });
    } else if (objective && card.insights.length === 1 && card.objective) {
      syncedInsights.push({ kind: 'good_decision', text: objective });
    }
  } else {
    if (idea) syncedInsights.push({ kind: 'played_move', text: idea });
    if (objective) syncedInsights.push({ kind: 'good_decision', text: objective });
  }

  return {
    ...card,
    headline: truncateWords(card.headline, max.maxHeadlineWords),
    idea: idea || undefined,
    objective: objective || undefined,
    insights: syncedInsights.slice(0, 2),
    takeaway,
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
