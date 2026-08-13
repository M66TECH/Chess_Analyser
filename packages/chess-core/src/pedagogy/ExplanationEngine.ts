import { MoveClassification, TacticalMotif } from './types';

const MOTIF_LABELS: Record<TacticalMotif['type'], string> = {
  hanging_piece: 'Pièce en prise',
  fork: 'Fourchette',
  pin: 'Clouage',
  skewer: 'Enfilade',
  discovered_attack: 'Attaque découverte',
};

export class ExplanationEngine {
  public static generateExplanation(
    classification: MoveClassification,
    motifs: TacticalMotif[],
    probDrop: number,
    accuracy: number
  ): string {
    const classLabel = this.getClassLabel(classification);

    // If there's a tactical motif detected in the position, contextualize
    if (motifs.length > 0) {
      const motif = motifs[0];
      const motifLabel = MOTIF_LABELS[motif.type] || motif.type;

      if (classification === 'blunder' || classification === 'mistake') {
        if (motif.type === 'hanging_piece') {
          return `${classLabel} — ${motif.description} Vous avez laissé une pièce sans défense.`;
        }
        if (motif.type === 'fork') {
          return `${classLabel} — ${motif.description} Votre adversaire peut maintenant exploiter cette fourchette.`;
        }
        return `${classLabel} — ${motifLabel} : ${motif.description}`;
      }

      if (classification === 'brilliant' || classification === 'great') {
        return `${classLabel} — Vous avez trouvé un coup exceptionnel ! ${motif.description}`;
      }

      return `${classLabel} — ${motifLabel} présent : ${motif.description}`;
    }

    // No motif — explain by classification + accuracy
    const accuracyText = accuracy >= 95 ? 'précision maximale' :
                         accuracy >= 80 ? 'très bonne précision' :
                         accuracy >= 60 ? 'précision correcte' :
                         accuracy >= 40 ? 'précision faible' : 'très faible précision';

    switch (classification) {
      case 'brilliant':
        return `${classLabel} ⭐ — Coup exceptionnel ! Un sacrifice ou une trouvaille que même un ordinateur apprécie. Précision : ${accuracy.toFixed(0)}%.`;
      case 'great':
        return `${classLabel} — Superbe coup défensif ou attaquant ! Vous avez trouvé la meilleure réponse à la situation. Précision : ${accuracy.toFixed(0)}%.`;
      case 'best':
        return `${classLabel} — Le meilleur coup selon l'ordinateur. Précision parfaite.`;
      case 'excellent':
        return `${classLabel} — Excellent coup, très proche de l'optimal. Précision : ${accuracy.toFixed(0)}%.`;
      case 'good':
        return `${classLabel} — Bon coup solide, sans risque majeur. Précision : ${accuracy.toFixed(0)}%.`;
      case 'inaccuracy':
        return `${classLabel} — Ce coup laisse échapper un léger avantage. Précision : ${accuracy.toFixed(0)}%. Cherchez un coup plus actif.`;
      case 'mistake':
        return `${classLabel} — Vous perdez un avantage significatif. Précision : ${accuracy.toFixed(0)}%. L'ordinateur suggère une approche différente.`;
      case 'blunder':
        return `${classLabel} — Gaffe grave ! Vous perdez potentiellement la décision de la partie. Précision : ${accuracy.toFixed(0)}%. Analysez pourquoi ce coup était mauvais.`;
      case 'book':
        return `${classLabel} — Coup théorique d'ouverture. Vous êtes dans la théorie connue.`;
      default:
        return 'Coup joué.';
    }
  }

  private static getClassLabel(c: MoveClassification): string {
    const labels: Record<MoveClassification, string> = {
      brilliant: '!! Brillant',
      great: '! Excellent',
      best: '✓ Meilleur',
      excellent: '✓ Excellent',
      good: '• Bon',
      inaccuracy: '?! Imprécision',
      mistake: '? Erreur',
      blunder: '?? Gaffe',
      book: '📖 Théorie',
    };
    return labels[c] ?? c;
  }
}
