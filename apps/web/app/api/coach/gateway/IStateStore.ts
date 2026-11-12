export interface KeyHealthState {
  keyHash: string;
  isRevoked: boolean;
  cooldownUntil: number; // Timestamp en millisecondes
  failureCount: number;
  lastErrorStatus?: number;
  cooldownReason?: string;
}

export interface ProviderMetrics {
  totalCalls: number;
  successCalls: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  consecutive5xx: number;
  hostCooldownUntil: number;
}

export interface IStateStore {
  /** Vérifie l'état de santé d'une clé (quarantaine, révocation) */
  getKeyState(keyHash: string): Promise<KeyHealthState | null>;

  /** Met une clé en quarantaine temporaire */
  setKeyCooldown(keyHash: string, durationMs: number, reason?: string, status?: number): Promise<void>;

  /** Révoque définitivement une clé (persistant sur disque) */
  revokeKey(keyHash: string, reason?: string): Promise<void>;

  /** Réactivation administrative éventuelle */
  unrevokeKey(keyHash: string): Promise<void>;

  /** Rotation atomique équitable pour sélectionner l'index de clé */
  getNextKeyIndexAtomic(providerId: string, poolSize: number): Promise<number>;

  /** Enregistre les métriques d'appel pour le calcul du score dynamique */
  recordMetrics(providerId: string, latencyMs: number, success: boolean, httpStatus?: number): Promise<void>;

  /** Récupère les métriques d'un fournisseur */
  getMetrics(providerId: string): Promise<ProviderMetrics>;

  /** Marque un modèle comme indisponible/404 sur un fournisseur */
  setModelUnavailable(providerId: string, modelId: string, unavailable: boolean): Promise<void>;

  /** Vérifie si un modèle est actif sur un fournisseur */
  isModelAvailable(providerId: string, modelId: string): Promise<boolean>;

  /** Met l'hôte d'un fournisseur en quarantaine temporaire (sur erreur 5xx) */
  setHostCooldown(providerId: string, durationMs: number): Promise<void>;

  /** Vérifie si l'hôte du fournisseur est en cooldown */
  isHostInCooldown(providerId: string): Promise<boolean>;
}
