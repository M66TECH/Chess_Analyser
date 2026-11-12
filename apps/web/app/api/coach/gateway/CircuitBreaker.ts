import type { IStateStore } from './IStateStore';
import { hashKey, maskKey } from './MemoryStateStore';

export interface HttpResponseMeta {
  status: number;
  statusText?: string;
  headers?: Headers;
  bodyText?: string;
}

export class CircuitBreaker {
  constructor(private store: IStateStore) {}

  /**
   * Vérifie si une clé est opérationnelle (non révoquée et hors de quarantaine).
   */
  public async isKeyAvailable(key: string): Promise<boolean> {
    const keyHash = hashKey(key);
    const state = await this.store.getKeyState(keyHash);
    if (!state) return true;
    if (state.isRevoked) return false;
    if (state.cooldownUntil > Date.now()) return false;
    return true;
  }

  /**
   * Traite une erreur HTTP selon sa sémantique exacte et applique la sanction appropriée.
   */
  public async handleHttpFailure(
    providerId: string,
    key: string,
    modelId: string,
    response: HttpResponseMeta
  ): Promise<string> {
    const keyHash = hashKey(key);
    const masked = maskKey(key);
    const status = response.status;
    const body = response.bodyText || '';

    switch (status) {
      case 401: {
        // Clé révoquée ou invalide : exclusion définitive persistante
        await this.store.revokeKey(keyHash, `HTTP 401: Clé invalide`);
        return `[CircuitBreaker] Clé ${masked} de ${providerId} révoquée définitivement (HTTP 401)`;
      }

      case 402: {
        // Crédits épuisés : quarantaine longue d'une heure
        const ONE_HOUR_MS = 60 * 60 * 1000;
        await this.store.setKeyCooldown(keyHash, ONE_HOUR_MS, 'HTTP 402 Payment Required', 402);
        return `[CircuitBreaker] Clé ${masked} de ${providerId} en quarantaine longue (HTTP 402 : crédits épuisés)`;
      }

      case 429: {
        // Limitation de débit : parse Retry-After ou applique 60s par défaut
        let cooldownMs = 60_000;
        const retryAfter = response.headers?.get('retry-after');

        if (retryAfter) {
          const parsedSec = Number.parseInt(retryAfter, 10);
          if (!Number.isNaN(parsedSec) && parsedSec > 0) {
            cooldownMs = Math.min(parsedSec * 1000, 300_000); // Plafond à 5 min
          } else {
            const parsedDate = Date.parse(retryAfter);
            if (!Number.isNaN(parsedDate) && parsedDate > Date.now()) {
              cooldownMs = Math.min(parsedDate - Date.now(), 300_000);
            }
          }
        }

        await this.store.setKeyCooldown(
          keyHash,
          cooldownMs,
          `HTTP 429 Rate Limited (Retry-After: ${cooldownMs / 1000}s)`,
          429
        );
        return `[CircuitBreaker] Clé ${masked} de ${providerId} en pause 429 pour ${cooldownMs / 1000}s`;
      }

      case 403: {
        // Vérifie si l'accès est interdit spécifiquement pour ce modèle ou le compte
        const isModelForbidden =
          body.toLowerCase().includes('model') || body.toLowerCase().includes('permission');
        if (isModelForbidden) {
          await this.store.setModelUnavailable(providerId, modelId, true);
          return `[CircuitBreaker] Modèle ${modelId} non autorisé sur ${providerId} (HTTP 403)`;
        }
        // Sinon pause sur la clé
        await this.store.setKeyCooldown(keyHash, 300_000, 'HTTP 403 Forbidden', 403);
        return `[CircuitBreaker] Clé ${masked} de ${providerId} mise en pause 5m (HTTP 403)`;
      }

      case 404: {
        // Règle 3 : Ne pas désactiver aveuglément un modèle sur 404.
        // On vérifie que la réponse JSON confirme explicitement une erreur de type model_not_found.
        let isConfirmedModelNotFound = false;
        try {
          const json = JSON.parse(body) as { error?: { code?: string; message?: string; type?: string } };
          const errCode = json.error?.code?.toLowerCase() || '';
          const errMsg = json.error?.message?.toLowerCase() || '';
          if (
            errCode === 'model_not_found' ||
            errCode === 'model_not_available' ||
            errMsg.includes('does not exist') ||
            errMsg.includes('model not found')
          ) {
            isConfirmedModelNotFound = true;
          }
        } catch {
          // Si le corps n'est pas du JSON structuré (ex: page HTML 404 d'une mauvaise URL),
          // on NE désactive PAS le modèle.
          isConfirmedModelNotFound = false;
        }

        if (isConfirmedModelNotFound) {
          await this.store.setModelUnavailable(providerId, modelId, true);
          return `[CircuitBreaker] Modèle ${modelId} introuvable sur ${providerId} (confirmé HTTP 404 model_not_found)`;
        }

        // Si ce n'est pas un model_not_found avéré, on pénalise l'endpoint hôte temporairement
        await this.store.setHostCooldown(providerId, 30_000);
        return `[CircuitBreaker] Endpoint ${providerId} a retourné 404 non-modèle : pause hôte 30s`;
      }

      case 500:
      case 502:
      case 503:
      case 504: {
        // Règle : Pénalité temporaire de l'endpoint distant, JAMAIS de révocation de la clé
        const hostCooldownMs = 20_000;
        await this.store.setHostCooldown(providerId, hostCooldownMs);
        return `[CircuitBreaker] Serveur ${providerId} indisponible (HTTP ${status}) : pause globale de l'hôte 20s (clés préservées)`;
      }

      default: {
        return `[CircuitBreaker] Échec HTTP ${status} sur ${providerId} (${modelId})`;
      }
    }
  }
}
