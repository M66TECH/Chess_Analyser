import { RiverAPI } from './RiverAPI';
import { uciToSan } from '../utils/san';
import {
  buildExplanationContext,
  pieceToFr,
  type CoachCard,
  type ExplanationContext,
  type Insight,
  type PlayerLevel,
} from './ExplanationContext';
import type { MoveRecord } from './types';

import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';

/**
 * Coach IA : transforme le VERDICT de l'analyse Lichess en explications
 * accessibles. Il ne remplace jamais l'analyse : il la traduit.
 *
 * Architecture volontairement en deux temps :
 *   1. `buildContext` extrait des faits vérifiables (évaluations, classification,
 *      meilleur coup, théorie) → le modèle ne peut pas inventer un coup ;
 *   2. le modèle rédige des fiches courtes, une par axe pédagogique.
 *
 * En cas d'échec du modèle, `fallbackCard` produit une explication déterministe
 * à partir des seuls chiffres : l'utilisateur a toujours une réponse.
 */
export class ExplanationEngine {
  private static readonly SYSTEM_PROMPT = `# Rôle
Tu es ChessCoach, entraîneur d'échecs francophone pour débutants et joueurs intermédiaires.
Tu expliques une analyse DÉJÀ calculée par Lichess. Tu ne joues pas, tu ne recalcules pas, tu expliques.

# Sources de vérité
Le JSON fourni est ta seule source. Tu ne peux citer que :
- le coup joué (played.san) et le meilleur coup (best.san) ;
- la pièce déplacée (played.piece) et la pièce capturée (played.captured) si renseignées ;
- les évaluations (evaluation.*) et le verdict (verdict.*) ;
- les données d'ouverture (opening.*).
Si une information manque, ne l'invente pas : dis simplement qu'elle n'est pas disponible.

# Ce que tu dois expliquer, dans cet ordre
1. played_move — ce que le coup joué fait concrètement (attaque, défend, développe, capture, crée une menace).
2. mistake — seulement si verdict.classification vaut inaccuracy, mistake ou blunder : pourquoi c'est mauvais.
3. missed_move — seulement si best.san existe et diffère du coup joué : ce que le meilleur coup apportait.
4. consequence — la conséquence tactique ou stratégique immédiate (pièce en prise, roi exposé, colonne ouverte, tempo perdu...).
5. good_decision — si le coup est bon/meilleur/brillant : pourquoi c'était le bon choix.

# Règles de rédaction
- Français simple. Aucun jargon non expliqué. Pas de « centipawn » : parle en « pions d'avantage » ou « chances ».
- Une idée par phrase, 25 mots maximum par phrase.
- N'affirme JAMAIS qu'un coup gagne du matériel sans que played.captured le confirme.
- Ne parle jamais de tactique absente des données fournies.
- Si opening.is_theory_move est vrai : ce coup est de la théorie humaine. Ne le présente jamais comme une erreur, même si Stockfish préfère autre chose. Explique l'idée de la ligne.
- Si opening.in_book est faux, ignore la théorie et appuie-toi uniquement sur les évaluations.
- Ton chaleureux, jamais condescendant. On encourage, on ne juge pas.

# Séquences de mat (context.mate_sequence)
- « created » : à cause de ce coup, le joueur va se faire mater de force. C'est LA conséquence à expliquer en premier (« le mat est désormais inévitable »).
- « lost » : le joueur avait un mat forcé et l'a laissé filer. Dis ce qui est perdu, sans dramatiser si evaluation_after montre qu'il reste largement gagnant.
- « delayed » : le mat reste forcé, simplement en plus de coups. Ce n'est PAS une erreur, ne le présente pas comme telle.

# Format
Réponds UNIQUEMENT par un objet JSON valide, sans texte autour :
{"headline":"...","insights":[{"kind":"played_move","text":"..."}],"takeaway":"..."}
Les valeurs possibles de "kind" sont exactement : played_move, missed_move, mistake, good_decision, consequence.`;

  /** Génère la fiche pédagogique d'un coup analysé. */
  public static async generateCard(
    record: MoveRecord,
    level: PlayerLevel = 'intermediaire',
    previousClassification?: string | null
  ): Promise<CoachCard> {
    const context = this.buildContext(record, previousClassification);

    try {
      const raw = await RiverAPI.complete(this.buildPrompt(context, level), this.SYSTEM_PROMPT, {
        temperature: 0.4,
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

  /**
   * Construit le dossier factuel. Tout ce qui est envoyé au modèle est extrait
   * du `MoveRecord`, jamais de la position seule.
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

    return buildExplanationContext({
      record,
      playedPiece,
      capturedPiece,
      bestMoveSan: record.bestMove ? uciToSan(record.fenBefore, record.bestMove) : null,
      previousClassification,
      materialCount,
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
   * Explication déterministe, sans réseau. Sert de secours quand le modèle est
   * indisponible : l'analyse Lichess reste lisible sans IA.
   */
  public static fallbackCard(context: ExplanationContext, level: PlayerLevel): CoachCard {
    const { played, best, verdict, evaluation } = context;
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

    const isError = verdict.classification === 'inaccuracy' || verdict.classification === 'mistake' || verdict.classification === 'blunder';
    if (isError) {
      const loss = evaluation.player_loss_cp;
      insights.push({
        kind: 'mistake',
        text:
          loss !== null
            ? `Ce coup fait perdre environ ${(loss / 100).toFixed(1)} pion(s) de valeur : ${cp(evaluation.before)} → ${cp(evaluation.after)}.`
            : "Ce coup détériore la position selon l'analyse.",
      });
    }

    if (best?.san && best.san !== played.san) {
      insights.push({
        kind: 'missed_move',
        text: `Le meilleur coup était ${best.san}, qui gardait la position plus solide.`,
      });
    }

    if (!isError && played.captured) {
      insights.push({
        kind: 'consequence',
        text: `Le gain de matériel se confirme : ${played.captured} disparaît de l'échiquier.`,
      });
    } else if (!isError) {
      insights.push({
        kind: 'good_decision',
        text: 'Le coup respecte l\'évaluation de la position et ne concède rien.',
      });
    }

    return {
      headline: label[verdict.classification] ?? 'Coup joué',
      insights,
      takeaway: isError
        ? 'Cherchez d\'abord les coups actifs de l\'adversaire avant de jouer.'
        : 'Continuez avec des coups qui ne laissent aucune pièce sans défense.',
      level,
    };
  }
}
