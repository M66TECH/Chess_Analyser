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
Tu es ChessCoach, entraîneur d'échecs francophone rigoureux et bienveillant.
Tu expliques une analyse DÉJÀ calculée par Stockfish/Lichess et par notre extracteur géométrique (SEE, clouages, structure de pions). Tu ne recalcules pas, tu expliques les faits prouvés.

# Hiérarchie stricte des preuves (INTERDICTION D'HALLUCINER)
Le JSON fourni est ta seule source de vérité. Distingue obligatoirement :
1. Les FAITS ÉTABLIS PAR LE MOTEUR : coup joué (played.san), meilleur coup (best.san), évaluations (evaluation.*) et verdict (verdict.*).
2. LES CONSÉQUENCES DES VARIANTES : la variante recommandée (best.pv_san) et la réfutation adverse (tactical_facts.refutation_pv_san, tactical_facts.material_delta_in_pv).
3. LES MOTIFS VÉRIFIÉS SUR L'ÉCHIQUIER (tactical_facts.*) :
   - Pièces laissées en prise : tactical_facts.newly_undefended_own_pieces
   - Pièces adverses attaquées : tactical_facts.newly_undefended_enemy_pieces
   - Clouages : tactical_facts.new_pins_against_player et tactical_facts.new_pins_by_player
   - Structure de pions et roi : tactical_facts.positional_changes
4. LES INTERPRÉTATIONS POSITIONNELLES : si aucun motif tactique n'est présent dans tactical_facts, formule l'explication stratégique avec prudence (« ce coup cède du contrôle central / perd un temps ») sans JAMAIS inventer une fourchette, un clouage ou une pièce en prise absents de tactical_facts.

# Ce que tu dois expliquer, dans cet ordre
1. played_move — ce que le coup joué fait concrètement (pièce déplacée, prise confirmée par played.captured, ou menace vérifiée).
2. mistake — seulement si verdict.classification vaut inaccuracy, mistake ou blunder : pourquoi c'est mauvais (cite la pièce en prise de newly_undefended_own_pieces ou la réponse adverse refutation_pv_san[0] si présentes).
3. missed_move — seulement si best.san existe et diffère du coup joué : ce que le meilleur coup best.san (et best.pv_san) apportait.
4. consequence — la conséquence tactique ou stratégique immédiate prouvée par les données.
5. good_decision — si le coup est bon/meilleur/brillant : pourquoi c'était le bon choix.

# Règles de rédaction
- Français simple et précis. Pas de « centipawn » : parle en « pions d'avantage » ou « chances ».
- Une idée par phrase, 25 mots maximum par phrase.
- N'affirme JAMAIS qu'un coup gagne du matériel sans que played.captured ou tactical_facts.material_delta_in_pv le confirme.
- N'invente JAMAIS un clouage, une fourchette ou une pièce en prise qui ne figure pas dans tactical_facts.
- Si opening.is_theory_move est vrai : ce coup est de la théorie humaine. Ne le présente jamais comme une erreur.

# Séquences de mat (context.mate_sequence)
- « created » : à cause de ce coup, le joueur subit un mat forcé (« le mat est désormais inévitable »).
- « lost » : le joueur avait un mat forcé et l'a laissé filer.
- « delayed » : le mat reste forcé, simplement en plus de coups. Ce n'est PAS une erreur.

# Format
Réponds UNIQUEMENT par un objet JSON valide, sans texte autour :
{"headline":"...","insights":[{"kind":"played_move","text":"..."}],"takeaway":"..."}
Les valeurs possibles de "kind" sont exactement : played_move, missed_move, mistake, good_decision, consequence.`;

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
        return { ...parsed, level };
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

    return `${levelInstructions[level]}

Dossier d'analyse Lichess (JSON) :
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

Écris la fiche JSON demandée.`;
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
   * Explication déterministe enrichie par les faits tactiques/positionnels
   * vérifiés (sans réseau). Sert de secours quand le modèle est indisponible
   * et lors des analyses complètes de PGN.
   */
  public static fallbackCard(context: ExplanationContext, level: PlayerLevel): CoachCard {
    const { played, best, verdict, evaluation, context: moveCtx, tactical_facts: facts } = context;
    const cp = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${(v / 100).toFixed(1)}`);

    const label: Record<string, string> = {
      brilliant: 'Coup brillant',
      great: 'Très bon coup',
      best: 'Meilleur coup',
      excellent: 'Excellent coup',
      good: 'Bon coup',
      book: 'Coup de théorie',
      inaccuracy: 'Imprécision',
      mistake: 'Erreur',
      blunder: 'Gaffe',
    };

    const insights: Insight[] = [];
    const pieceLabel = played.piece ? `le ${played.piece}` : 'la pièce';
    const capture = played.captured ? ` et prend ${played.captured === 'pion (en passant)' ? 'un pion' : `le ${played.captured}`}` : '';

    insights.push({
      kind: 'played_move',
      text: `${played.san} déplace ${pieceLabel}${capture}.`,
    });

    const isError =
      verdict.classification === 'inaccuracy' ||
      verdict.classification === 'mistake' ||
      verdict.classification === 'blunder';

    if (isError) {
      const loss = evaluation.player_loss_cp;
      if (moveCtx.mate_sequence === 'created') {
        insights.push({
          kind: 'mistake',
          text: 'Ce coup permet un mat forcé adverse : le mat est désormais inévitable.',
        });
      } else if (moveCtx.mate_sequence === 'lost') {
        insights.push({
          kind: 'mistake',
          text: 'Ce coup laisse échapper une séquence de mat forcé.',
        });
      } else if (facts && facts.newly_undefended_own_pieces.length > 0) {
        const hanging = facts.newly_undefended_own_pieces[0];
        insights.push({
          kind: 'mistake',
          text: `Ce coup laisse votre ${hanging.piece} en ${hanging.square} sans défense suffisante (${cp(evaluation.before)} → ${cp(evaluation.after)}).`,
        });
      } else if (facts && facts.new_pins_against_player.length > 0) {
        const pin = facts.new_pins_against_player[0];
        insights.push({
          kind: 'mistake',
          text: `Ce coup expose votre ${pin.pinned_piece} en ${pin.pinned_square} à un clouage par ${pin.pinner_square} (${cp(evaluation.before)} → ${cp(evaluation.after)}).`,
        });
      } else {
        insights.push({
          kind: 'mistake',
          text:
            loss !== null
              ? `Ce coup fait perdre environ ${(loss / 100).toFixed(1)} pion(s) de valeur : ${cp(evaluation.before)} → ${cp(evaluation.after)}.`
              : "Ce coup détériore la position selon l'analyse.",
        });
      }

      if (facts && facts.refutation_pv_san.length > 0 && level !== 'debutant') {
        const refutationLine = facts.refutation_pv_san.slice(0, 3).join(' ');
        insights.push({
          kind: 'consequence',
          text: `L'adversaire peut punir ce coup par la suite : ${refutationLine}.`,
        });
      } else if (facts && facts.positional_changes.doubled_pawns_created.length > 0) {
        insights.push({
          kind: 'consequence',
          text: `La structure de pions est affaiblie (pions doublés en ${facts.positional_changes.doubled_pawns_created.join(', ')}).`,
        });
      }
    }

    if (best?.san && best.san !== played.san) {
      const pvContinuation =
        level !== 'debutant' && best.pv_san && best.pv_san.length > 1
          ? ` (suite : ${best.pv_san.slice(0, 3).join(' ')})`
          : '';
      insights.push({
        kind: 'missed_move',
        text: `Le meilleur coup était ${best.san}${pvContinuation}, qui gardait la position plus solide.`,
      });
    }

    if (!isError && played.captured) {
      insights.push({
        kind: 'consequence',
        text: `Le gain de matériel se confirme : ${played.captured} disparaît de l'échiquier.`,
      });
    } else if (!isError) {
      if (facts && facts.new_pins_by_player.length > 0) {
        const pin = facts.new_pins_by_player[0];
        insights.push({
          kind: 'good_decision',
          text: `Excellent choix qui cloue le ${pin.pinned_piece} adverse en ${pin.pinned_square}.`,
        });
      } else if (facts && facts.newly_undefended_enemy_pieces.length > 0) {
        const target = facts.newly_undefended_enemy_pieces[0];
        insights.push({
          kind: 'good_decision',
          text: `Ce coup met directement sous pression le ${target.piece} adverse en ${target.square}.`,
        });
      } else {
        insights.push({
          kind: 'good_decision',
          text: "Le coup respecte l'évaluation de la position et ne concède rien.",
        });
      }
    }

    return {
      headline: label[verdict.classification] ?? 'Coup joué',
      insights,
      takeaway: isError
        ? "Cherchez d'abord les coups actifs et captures de l'adversaire avant de jouer."
        : 'Continuez avec des coups qui ne laissent aucune pièce sans défense.',
      level,
    };
  }
}
