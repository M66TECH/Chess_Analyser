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

import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeSquare, parseUci } from 'chessops/util';
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
function extractVerifiedTacticalFacts(record: MoveRecord): VerifiedTacticalFacts | undefined {
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

# Format
Réponds UNIQUEMENT par un objet JSON valide :
{"headline":"...","insights":[{"kind":"played_move","text":"..."}],"takeaway":"..."}
kinds autorisés : played_move, missed_move, mistake, good_decision, consequence.`;

  /** Génère la fiche pédagogique d'un coup analysé (avec appel IA + fallback local). */
  public static async generateCard(
    record: MoveRecord,
    level: PlayerLevel = 'intermediaire',
    previousClassification?: string | null
  ): Promise<CoachCard> {
    const context = this.buildContext(record, previousClassification);

    try {
      const raw = await RiverAPI.complete(this.buildPrompt(context, level), this.SYSTEM_PROMPT, {
        temperature: 0.3,
        maxTokens: 900,
      });
      const parsed = this.parseCard(raw);
      if (parsed) {
        // Le prompt demande la brièveté ; le code la GARANTIT (un modèle peut
        // dépasser). Mêmes bornes que le fallback local.
        return applyMoodLimits({ ...parsed, level }, context);
      }
    } catch (error) {
      console.error('[ExplanationEngine] Falling back to local explanation:', error);
    }

    return this.fallbackCard(context, level);
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
- Explique brièvement la séquence suivante, coup par coup, en une phrase TRÈS courte chacun (12 mots maximum).
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
   * Explication déterministe, COURTE et sans notation (ni « Nf3 » ni « e2e4 »).
   * Sert de secours quand le modèle est indisponible et lors des imports PGN.
   *
   * Structure imposée : un constat (le problème), une action (quoi faire), et
   * un seul conseil final. Les variantes ne sont pas racontées en texte : elles
   * sont montrées sur l'échiquier (`buildDemo`), comme demandé.
   */
  public static fallbackCard(context: ExplanationContext, level: PlayerLevel): CoachCard {
    const { played, best, verdict, context: moveCtx, tactical_facts: facts } = context;

    const isError =
      verdict.classification === 'inaccuracy' ||
      verdict.classification === 'mistake' ||
      verdict.classification === 'blunder';

    // Description du coup joué en français simple (jamais la notation seule).
    const playedDesc = describeMove(context.fen_before, played.uci);
    const playedText = playedDesc
      ? playedDesc.text
      : describePlayedFromContext(played);

    // Le meilleur coup, décrit pareil (pièce + case).
    const bestDesc = best?.uci ? describeMove(context.fen_before, best.uci) : null;

    const insights: Insight[] = [];

    if (isError) {
      // 1. Le problème, en une phrase.
      if (moveCtx.mate_sequence === 'created') {
        insights.push({ kind: 'mistake', text: 'Votre roi va se faire mater.' });
      } else if (moveCtx.mate_sequence === 'lost') {
        insights.push({ kind: 'mistake', text: 'Vous laissez filer un mat gagnant.' });
      } else if (facts && facts.newly_undefended_own_pieces.length > 0) {
        const hanging = facts.newly_undefended_own_pieces[0];
        insights.push({
          kind: 'mistake',
          text: `Votre ${hanging.piece} en ${hanging.square} peut être prise.`,
        });
      } else if (facts && facts.new_pins_against_player.length > 0) {
        const pin = facts.new_pins_against_player[0];
        insights.push({
          kind: 'mistake',
          text: `Votre ${pin.pinned_piece} ne peut plus bouger sans perdre du matériel.`,
        });
      } else {
        insights.push({
          kind: 'mistake',
          text: 'Ce coup affaiblit votre position.',
        });
      }

      // 2. L'action recommandée, en une phrase.
      insights.push({
        kind: 'missed_move',
        text: bestDesc ? `Jouez plutôt : ${lowerFirst(bestDesc.text)}` : 'Cherchez un coup qui protège vos pièces.',
      });
    } else {
      insights.push({ kind: 'played_move', text: playedText });
      insights.push({
        kind: 'good_decision',
        text: 'C’est un bon coup : vous ne perdez rien.',
      });
    }

    // Un seul conseil final, très court.
    let takeaway: string;
    if (moveCtx.mate_sequence === 'created') {
      takeaway = 'Avant de jouer, vérifiez ce que l’adversaire peut faire contre votre roi.';
    } else if (isError) {
      takeaway = 'Vérifiez toujours si vos pièces sont protégées après votre coup.';
    } else if (bestDesc) {
      takeaway = 'Continuez à protéger vos pièces.';
    } else {
      takeaway = 'Vous progressez : la position reste saine.';
    }

    // Mêmes bornes que la carte issue du modèle (une seule source de vérité).
    return applyMoodLimits({
      headline: isError ? labelCourt(verdict.classification) : 'Bon coup',
      insights,
      takeaway,
      level,
    }, context);
  }
}

// --- aides locales ----------------------------------------------------------

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
    maxWordsPerInsight: 16,
    maxHeadlineWords: 8,
    maxTakeawayWords: 12,
  },
  great: {
    tone: 'Très bon coup. Encourage chaleureusement, valorise le choix du joueur.',
    maxInsights: 1,
    maxWordsPerInsight: 16,
    maxHeadlineWords: 8,
    maxTakeawayWords: 12,
  },
  best: {
    tone: "C'est le meilleur coup possible. Valide sobrement (« C'est le meilleur coup »), sans enthousiasme excessif.",
    maxInsights: 1,
    maxWordsPerInsight: 16,
    maxHeadlineWords: 8,
    maxTakeawayWords: 12,
  },
  excellent: {
    tone: 'Coup très correct. Encourage brièvement.',
    maxInsights: 1,
    maxWordsPerInsight: 16,
    maxHeadlineWords: 8,
    maxTakeawayWords: 12,
  },
  good: {
    tone: 'Coup correct. Reste neutre et bref.',
    maxInsights: 1,
    maxWordsPerInsight: 16,
    maxHeadlineWords: 8,
    maxTakeawayWords: 12,
  },
  book: {
    tone: "Coup de théorie (ouverture connue). Rassure : « c'est une ouverture classique, vous êtes bien ».",
    maxInsights: 1,
    maxWordsPerInsight: 16,
    maxHeadlineWords: 8,
    maxTakeawayWords: 12,
  },
  inaccuracy: {
    tone: "Petite imprécision. Signale-le doucement, sans dramatiser, et donne l'action.",
    maxInsights: 2,
    maxWordsPerInsight: 18,
    maxHeadlineWords: 9,
    maxTakeawayWords: 14,
  },
  mistake: {
    tone: "Erreur réelle. Sois ferme mais bienveillant : nomme le problème, puis la correction.",
    maxInsights: 2,
    maxWordsPerInsight: 18,
    maxHeadlineWords: 9,
    maxTakeawayWords: 14,
  },
  blunder: {
    tone: "Grosse erreur. AUCUN reproche, aucune dramatisation : rassure (« pas de panique »), puis donne la correction à jouer.",
    maxInsights: 2,
    maxWordsPerInsight: 18,
    maxHeadlineWords: 9,
    maxTakeawayWords: 14,
  },
  mate_created: {
    tone: 'Le joueur va se faire mater. Ton grave mais calme, sans fatalisme : explique la menace simplement.',
    maxInsights: 2,
    maxWordsPerInsight: 18,
    maxHeadlineWords: 9,
    maxTakeawayWords: 14,
  },
  mate_lost: {
    tone: "Le joueur avait un mat et l'a laissé filer. Ton déçu mais pas accablant ; rappelle qu'il reste peut-être gagnant.",
    maxInsights: 2,
    maxWordsPerInsight: 18,
    maxHeadlineWords: 9,
    maxTakeawayWords: 14,
  },
};

const DEFAULT_MOOD: Mood = {
  tone: 'Ton neutre et encourageant.',
  maxInsights: 1,
  maxWordsPerInsight: 16,
  maxHeadlineWords: 8,
  maxTakeawayWords: 12,
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

/** Verdict en mots simples (pas de vocabulaire technique). */
function labelCourt(classification: string): string {
  switch (classification) {
    case 'blunder':
      return 'Grosse erreur';
    case 'mistake':
      return 'Erreur';
    case 'inaccuracy':
      return 'Petite erreur';
    default:
      return 'Coup correct';
  }
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
  const piece = describePiece(played.piece).replace(/^(le|la) /, '');
  let text: string;
  if (played.captured) {
    // « pion (en passant) » reste lisible tel quel.
    const captured = played.captured.startsWith('pion')
      ? played.captured
      : `${['tour', 'dame'].includes(played.captured) ? 'la' : 'le'} ${played.captured}`;
    text = `Votre ${piece} prend ${captured}.`;
  } else {
    text = `Votre ${piece} change de case.`;
  }
  if (played.is_check) text += ' Le roi est en échec.';
  return text;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
