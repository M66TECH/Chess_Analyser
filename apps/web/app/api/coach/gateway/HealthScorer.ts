import type { ProviderConfig } from '../registry/types';
import type { ProviderMetrics } from './IStateStore';

export class HealthScorer {
  /**
   * Calcule le score dynamique d'un fournisseur selon la formule validée :
   * Score = (11 - P) * 10 + SR * 50 - (L / 100) - 30 * E
   *
   * Plus le score est élevé, plus le fournisseur est prioritaire et sain.
   */
  public static calculateScore(config: ProviderConfig, metrics: ProviderMetrics): number {
    // 1. Priorité de base (1 à 10) inversée : P=1 donne 100 pts, P=10 donne 10 pts
    const P = Math.min(Math.max(config.defaultPriority, 1), 10);
    const priorityPoints = (11 - P) * 10;

    // 2. Taux de succès SR entre 0 et 1 (1.0 par défaut si aucun appel encore fait)
    const SR =
      metrics.totalCalls > 0
        ? metrics.successCalls / metrics.totalCalls
        : 1.0;
    const successPoints = SR * 50;

    // 3. Pénalité de latence L (en millisecondes) :
    // Un fournisseur non encore mesuré (totalCalls === 0) part avec une estimation neutre (1200 ms)
    // et la pénalité est plafonnée à 15 pts afin qu'un fournisseur P1 sain (~2000 ms) ne soit pas
    // rétrogradé derrière un secours P2 non testé tant qu'il réussit ses appels.
    const L = metrics.totalCalls > 0 && metrics.avgLatencyMs > 0 ? metrics.avgLatencyMs : 1200;
    const latencyPenalty = Math.min(L / 200, 15);

    // 4. Pénalité des erreurs consécutives E (5xx)
    const E = metrics.consecutive5xx || 0;
    const errorPenalty = 30 * E;

    const finalScore = priorityPoints + successPoints - latencyPenalty - errorPenalty;
    return Math.round(finalScore * 10) / 10;
  }
}
