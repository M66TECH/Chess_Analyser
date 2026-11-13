import type { ProviderConfig, ModelConfig } from './types';

/**
 * Registre déclaratif central des fournisseurs d'IA.
 * 
 * L'ajout d'un nouveau fournisseur (Mistral, Together, Cerebras, Ollama, etc.)
 * se fait ici en déclarant simplement sa fiche signalétique.
 * Aucun code de routage ni de boucle d'appel n'a besoin d'être modifié.
 */
export const PROVIDERS_REGISTRY: ProviderConfig[] = [
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    envKeyName: 'GROQ_API_KEYS',
    envModelsName: 'GROQ_MODELS',
    defaultPriority: 1, // Priorité 1 : Ultra-rapide
    timeoutMs: 8_000,
    defaultModels: [
      { id: 'openai/gpt-oss-120b', profile: 'reasoning', maxTokensFloor: 350 },
      { id: 'openai/gpt-oss-20b', profile: 'fast' },
      { id: 'qwen/qwen3.8-27b', profile: 'reasoning', maxTokensFloor: 400 },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    envKeyName: 'OPENROUTER_API_KEY',
    envModelsName: 'OPENROUTER_MODELS',
    defaultPriority: 2, // Priorité 2 : Secours rapide et clair
    timeoutMs: 8_000,
    customHeaders: {
      'HTTP-Referer': 'https://chess-analyzer.local',
      'X-Title': 'Chess Analyzer Coach',
    },
    defaultModels: [
      { id: 'openrouter/free', profile: 'fast' },
      { id: 'cohere/north-mini-code:free', profile: 'general' },
    ],
  },
  {
    id: 'tokenharbor',
    name: 'TokenHarbor',
    baseUrl: 'https://tokenharbor.ai/v1/chat/completions',
    envKeyName: 'TOKENHARBOR_API_KEYS',
    envModelsName: 'TOKENHARBOR_MODELS',
    defaultPriority: 3, // Priorité 3 : Repli tertiaire
    timeoutMs: 8_000,
    defaultModels: [
      { id: 'deepseek-v4.1-flash:free', profile: 'fast' },
      { id: 'deepseek-v4-flash:free', profile: 'fast' },
      { id: 'mimo-v2.6-flash:free', profile: 'general' },
    ],
  },
];

/**
 * Résout les clés API configurées dans l'environnement pour un fournisseur.
 * Supporte le nom pluriel (ex: GROQ_API_KEYS) ou singulier (ex: GROQ_API_KEY).
 */
export function resolveKeysForProvider(config: ProviderConfig): string[] {
  const raw =
    process.env[config.envKeyName] ||
    process.env[config.envKeyName.replace(/S$/, '')] ||
    '';

  if (!raw.trim()) return [];

  return raw
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
}

/**
 * Résout la liste des modèles pour un fournisseur.
 * Si une variable d'environnement surcharge les modèles (ex: GROQ_MODELS),
 * elle prend le pas sur les modèles par défaut du registre.
 */
export function resolveModelsForProvider(config: ProviderConfig): ModelConfig[] {
  const envModels = config.envModelsName ? process.env[config.envModelsName] : undefined;

  if (envModels && envModels.trim().length > 0) {
    const ids = envModels.split(',').map(m => m.trim()).filter(Boolean);
    return ids.map(id => {
      // Retrouve le profil par défaut si connu
      const existing = config.defaultModels.find(
        m => (typeof m === 'string' ? m : m.id) === id
      );
      if (existing && typeof existing === 'object') return existing;
      return { id, profile: 'fast' };
    });
  }

  return config.defaultModels.map(m => (typeof m === 'string' ? { id: m, profile: 'fast' } : m));
}
