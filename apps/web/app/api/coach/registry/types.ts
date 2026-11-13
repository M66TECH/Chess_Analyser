export type ModelProfile = 'fast' | 'reasoning' | 'general' | 'fallback';

export interface ModelConfig {
  id: string;
  profile: ModelProfile;
  /** Tokens minimum à allouer pour les modèles avec réflexion (ex: 1400 pour GPT-OSS / DeepSeek R1) */
  maxTokensFloor?: number;
  /** Paramètres JSON supplémentaires spécifiques au modèle/fournisseur (ex: reasoning_effort) */
  extraBody?: Record<string, unknown>;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  /** Nom de la variable d'environnement contenant la ou les clés séparées par des virgules */
  envKeyName: string;
  /** Nom optionnel de la variable d'environnement pour surcharger les modèles */
  envModelsName?: string;
  /** Modèles configurés par défaut */
  defaultModels: Array<string | ModelConfig>;
  /** Priorité de base de 1 (très prioritaire) à 10 (secours) */
  defaultPriority: number;
  /** En-têtes HTTP personnalisés (ex: HTTP-Referer pour OpenRouter) */
  customHeaders?: Record<string, string>;
  /** Délai d'expiration unitaire recommandé (ms) */
  timeoutMs?: number;
  /** Si vrai, le fournisseur est activé */
  enabled?: boolean;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Profil cible souhaité (optionnel, 'fast' par défaut pour le coach) */
  targetProfile?: ModelProfile;
  /** Budget de temps global pour cette requête (ms) */
  globalTimeoutMs?: number;
  /** Signal d'annulation du client (ex: onglet fermé) */
  clientSignal?: AbortSignal;
}

export interface CompletionSuccess {
  ok: true;
  content: string;
  modelUsed: string;
  providerId: string;
  latencyMs: number;
  attemptsCount: number;
}

export interface CompletionFailure {
  ok: false;
  error: string;
  failures: string[];
  attemptsCount: number;
  remainingBudgetMs: number;
}

export type CompletionResult = CompletionSuccess | CompletionFailure;
