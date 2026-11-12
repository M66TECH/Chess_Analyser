import type { OpeningData } from './ExplorerCache';
import type {
  MoveTheoryResult,
  MoveEvidence,
  TheoryEvidenceSource,
} from '../pedagogy/types';

export interface TheoryDetectionOptions {
  fen: string;
  uci: string;
  data: OpeningData | null | undefined;
  opening?: { eco: string; name: string } | null;
  /** Vrai si le coup prolonge explicitement une variante canonique du livre local (Phase 3). */
  isCanonicalBookMove?: boolean;
  /** Dernier demi-coup théorique confirmé dans la partie jusqu'ici. */
  lastConfirmedPly?: number;
}

/**
 * Moteur pur de décision de conformité théorique (P2).
 *
 * Décorrélé de Stockfish et de toute requête réseau : évalue les preuves
 * matérielles fournies selon un arbre de décision strict et multi-critères.
 */
export class TheoryDetector {
  public static detect(options: TheoryDetectionOptions): MoveTheoryResult {
    const { uci, data, opening, isCanonicalBookMove = false, lastConfirmedPly } = options;

    const moves = Array.isArray(data?.moves) ? data.moves : [];
    const playedMove = moves.find((m) => m.uci === uci);

    const eco = opening?.eco ?? playedMove?.opening?.eco ?? data?.opening?.eco;
    const openingName = opening?.name ?? playedMove?.opening?.name ?? data?.opening?.name;

    // 1. Défaillance technique ou absence de réponse API
    if (!data) {
      return {
        status: 'uncertain',
        confidence: 'low',
        evidence: 'unavailable',
        source: isCanonicalBookMove ? 'canonical_opening' : 'insufficient_data',
        reason: isCanonicalBookMove
          ? 'Coup canonique documenté (données de maîtres indisponibles)'
          : "Données d'ouverture indisponibles (échec réseau ou timeout)",
        eco,
        openingName,
        totalMasterGamesInPosition: 0,
        masterGamesForMove: 0,
        frequency: 0,
        isCanonicalBookMove,
        lastConfirmedPly,
      };
    }

    const totalMasterGamesInPosition = (data.white ?? 0) + (data.draws ?? 0) + (data.black ?? 0);

    // 2. Réponse valide mais position inconnue des maîtres (N_pos === 0)
    if (totalMasterGamesInPosition === 0) {
      return {
        status: isCanonicalBookMove ? 'confirmed' : 'uncertain',
        confidence: isCanonicalBookMove ? 'high' : 'low',
        evidence: 'no_data',
        source: isCanonicalBookMove ? 'canonical_opening' : 'insufficient_data',
        reason: isCanonicalBookMove
          ? 'Coup canonique documenté (aucune partie de maîtres dans cette position)'
          : 'Aucune partie de maîtres recensée dans cette position',
        eco,
        openingName,
        totalMasterGamesInPosition: 0,
        masterGamesForMove: 0,
        frequency: 0,
        isCanonicalBookMove,
        lastConfirmedPly,
      };
    }

    // 3. Analyse du coup joué dans la réponse
    const masterGamesForMove = playedMove
      ? (playedMove.white ?? 0) + (playedMove.draws ?? 0) + (playedMove.black ?? 0)
      : 0;
    const frequency = totalMasterGamesInPosition > 0 ? masterGamesForMove / totalMasterGamesInPosition : 0;

    const isExhaustive = moves.length < 12;
    const cutoffMove = moves.length === 12 ? moves[11] : null;
    const cutoffGames = cutoffMove
      ? (cutoffMove.white ?? 0) + (cutoffMove.draws ?? 0) + (cutoffMove.black ?? 0)
      : undefined;

    // Qualification matérielle de la preuve (MoveEvidence)
    let evidence: MoveEvidence;
    if (playedMove) {
      evidence = 'found';
    } else if (isExhaustive) {
      evidence = 'verified_zero';
    } else {
      evidence = 'not_returned';
    }

    // Vérification de la validation statistique de maîtres (indépendante du canonique)
    const sortedMoves = [...moves].sort((a, b) => {
      const gA = (a.white ?? 0) + (a.draws ?? 0) + (a.black ?? 0);
      const gB = (b.white ?? 0) + (b.draws ?? 0) + (b.black ?? 0);
      return gB - gA;
    });
    const isTop1 = sortedMoves.length > 0 && sortedMoves[0].uci === uci;

    const hasStrongMasterConsensus =
      evidence === 'found' &&
      ((isTop1 && masterGamesForMove >= 30) ||
        (masterGamesForMove >= 30 && frequency >= 0.15) ||
        (masterGamesForMove >= 100 && frequency >= 0.08));

    // PRIORITÉ 1 : Preuve Canonique
    if (isCanonicalBookMove) {
      const source: TheoryEvidenceSource = hasStrongMasterConsensus ? 'both' : 'canonical_opening';
      return {
        status: 'confirmed',
        confidence: 'high',
        evidence,
        source,
        reason:
          source === 'both'
            ? `Coup canonique validé et confirmé par les maîtres (${masterGamesForMove.toLocaleString('fr-FR')} parties)`
            : 'Coup canonique documenté dans la variante',
        eco,
        openingName,
        totalMasterGamesInPosition,
        masterGamesForMove,
        frequency,
        isCanonicalBookMove: true,
        cutoffGames,
        lastConfirmedPly,
      };
    }

    // PRIORITÉ 2 : Preuve Statistique de Maîtres
    if (hasStrongMasterConsensus) {
      return {
        status: 'confirmed',
        confidence: 'high',
        evidence: 'found',
        source: 'master_statistics',
        reason: `Continuation majeure établie chez les maîtres (${masterGamesForMove.toLocaleString('fr-FR')} parties, ${Math.round(frequency * 100)} %)`,
        eco,
        openingName,
        totalMasterGamesInPosition,
        masterGamesForMove,
        frequency,
        isCanonicalBookMove: false,
        cutoffGames,
        lastConfirmedPly,
      };
    }

    // PRIORITÉ 3 : Sortie Établie de la Théorie (out_of_book)
    // Nécessite une position avec théorie bien documentée (N_pos >= 50)
    if (totalMasterGamesInPosition >= 50) {
      // Cas 3a : absence formellement vérifiée (liste exhaustive moves.length < 12)
      if (evidence === 'verified_zero') {
        return {
          status: 'out_of_book',
          confidence: totalMasterGamesInPosition >= 100 ? 'high' : 'medium',
          evidence: 'verified_zero',
          source: 'master_statistics',
          reason: `Déviation nette : aucune partie de maîtres recensée dans une position documentée (${totalMasterGamesInPosition.toLocaleString('fr-FR')} parties)`,
          eco,
          openingName,
          totalMasterGamesInPosition,
          masterGamesForMove: 0,
          frequency: 0,
          isCanonicalBookMove: false,
          cutoffGames,
          lastConfirmedPly,
        };
      }

      // Cas 3b : coup marginal documenté (< 1% des parties et <= 2 parties)
      if (evidence === 'found' && masterGamesForMove <= 2 && frequency < 0.01) {
        return {
          status: 'out_of_book',
          confidence: totalMasterGamesInPosition >= 100 ? 'high' : 'medium',
          evidence: 'found',
          source: 'master_statistics',
          reason: `Déviation : continuation marginale (${masterGamesForMove} partie(s), < 1 %) dans une position établie`,
          eco,
          openingName,
          totalMasterGamesInPosition,
          masterGamesForMove,
          frequency,
          isCanonicalBookMove: false,
          cutoffGames,
          lastConfirmedPly,
        };
      }

      // Cas 3c : coup non retourné mais saturation prouvée mathématiquement (N12 / N_pos < 0.01)
      if (evidence === 'not_returned' && cutoffGames !== undefined) {
        const cutoffRatio = cutoffGames / totalMasterGamesInPosition;
        if (cutoffRatio < 0.01) {
          return {
            status: 'out_of_book',
            confidence: totalMasterGamesInPosition >= 100 ? 'high' : 'medium',
            evidence: 'not_returned',
            source: 'master_statistics',
            reason: `Déviation nette : coup absent du Top 12 dont le seuil est inférieur à 1 % des parties (${cutoffGames} parties)`,
            eco,
            openingName,
            totalMasterGamesInPosition,
            masterGamesForMove: 0,
            frequency: 0,
            isCanonicalBookMove: false,
            cutoffGames,
            lastConfirmedPly,
          };
        }
      }
    }

    // PRIORITÉ 4 : RÈGLE PAR DÉFAUT (uncertain)
    // Couvre :
    // - N_pos < 30 (échantillon global trop faible)
    // - 30 <= N_pos < 50 sans coup répertorié
    // - Coup marginal ou intermédiaire (ex: 3 à 29 parties, ou f < 8% sans volume massif)
    // - Coup not_returned avec seuil N12 / N_pos >= 0.01 (impossibilité mathématique de trancher)
    let uncertainReason = 'Continuation rare ou échantillon de maîtres insuffisant pour trancher';
    if (evidence === 'not_returned' && cutoffGames !== undefined) {
      uncertainReason = `Coup absent du Top 12 (seuil N12 = ${cutoffGames} parties) ; données insuffisantes pour affirmer une sortie`;
    } else if (evidence === 'found') {
      uncertainReason = `Continuation secondaire (${masterGamesForMove} partie(s), ${Math.round(frequency * 100)} %) sans consensus établi`;
    } else if (totalMasterGamesInPosition < 50) {
      uncertainReason = `Position peu explorée à haut niveau (${totalMasterGamesInPosition} parties totales) ; certitude impossible`;
    }

    return {
      status: 'uncertain',
      confidence: totalMasterGamesInPosition >= 30 ? 'medium' : 'low',
      evidence,
      source: 'master_statistics',
      reason: uncertainReason,
      eco,
      openingName,
      totalMasterGamesInPosition,
      masterGamesForMove,
      frequency,
      isCanonicalBookMove: false,
      cutoffGames,
      lastConfirmedPly,
    };
  }
}
