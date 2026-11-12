import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { IStateStore, KeyHealthState, ProviderMetrics } from './IStateStore';

/**
 * Calcule une empreinte non-réversible d'une clé API pour l'observabilité et le stockage.
 * Ne logge ni ne persiste jamais la clé en clair.
 */
export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key.trim()).digest('hex').slice(0, 16);
}

/**
 * Masque une clé pour les logs (ex: "gsk_...7m3i").
 */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '***';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export class MemoryStateStore implements IStateStore {
  private keyStates = new Map<string, KeyHealthState>();
  private providerMetrics = new Map<string, ProviderMetrics>();
  private providerCursors = new Map<string, number>();
  private unavailableModels = new Set<string>();
  private hostCooldowns = new Map<string, number>();
  private revokedKeysFilePath: string;

  constructor(storageDir?: string) {
    const dir = storageDir || process.cwd();
    this.revokedKeysFilePath = path.join(dir, '.revoked-keys.json');
    this.loadRevokedKeys();
  }

  private loadRevokedKeys(): void {
    try {
      if (fs.existsSync(this.revokedKeysFilePath)) {
        const raw = fs.readFileSync(this.revokedKeysFilePath, 'utf8');
        const data = JSON.parse(raw) as Record<string, { revokedAt: number; reason?: string }>;
        for (const [keyHash, info] of Object.entries(data)) {
          this.keyStates.set(keyHash, {
            keyHash,
            isRevoked: true,
            cooldownUntil: Infinity,
            failureCount: 1,
            cooldownReason: info.reason || 'Persistent revocation',
          });
        }
      }
    } catch {
      // Échec silencieux si le fichier est verrouillé ou non lisible
    }
  }

  private persistRevokedKeys(): void {
    try {
      const data: Record<string, { revokedAt: number; reason?: string }> = {};
      for (const [keyHash, state] of this.keyStates.entries()) {
        if (state.isRevoked) {
          data[keyHash] = { revokedAt: Date.now(), reason: state.cooldownReason };
        }
      }
      fs.writeFileSync(this.revokedKeysFilePath, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // Échec silencieux
    }
  }

  public async getKeyState(keyHash: string): Promise<KeyHealthState | null> {
    const state = this.keyStates.get(keyHash);
    if (!state) return null;

    // Si la quarantaine est expirée et que la clé n'est pas révoquée, elle redevient saine
    if (!state.isRevoked && state.cooldownUntil > 0 && Date.now() >= state.cooldownUntil) {
      state.cooldownUntil = 0;
      state.cooldownReason = undefined;
    }

    return state;
  }

  public async setKeyCooldown(
    keyHash: string,
    durationMs: number,
    reason?: string,
    status?: number
  ): Promise<void> {
    const existing = this.keyStates.get(keyHash) || {
      keyHash,
      isRevoked: false,
      cooldownUntil: 0,
      failureCount: 0,
    };

    existing.cooldownUntil = Date.now() + durationMs;
    existing.failureCount += 1;
    existing.cooldownReason = reason;
    existing.lastErrorStatus = status;

    this.keyStates.set(keyHash, existing);
  }

  public async revokeKey(keyHash: string, reason?: string): Promise<void> {
    const existing = this.keyStates.get(keyHash) || {
      keyHash,
      isRevoked: true,
      cooldownUntil: Infinity,
      failureCount: 1,
    };

    existing.isRevoked = true;
    existing.cooldownUntil = Infinity;
    existing.cooldownReason = reason || 'HTTP 401 Unauthorized';

    this.keyStates.set(keyHash, existing);
    this.persistRevokedKeys();
  }

  public async unrevokeKey(keyHash: string): Promise<void> {
    const existing = this.keyStates.get(keyHash);
    if (existing) {
      existing.isRevoked = false;
      existing.cooldownUntil = 0;
      existing.failureCount = 0;
      this.persistRevokedKeys();
    }
  }

  public async getNextKeyIndexAtomic(providerId: string, poolSize: number): Promise<number> {
    if (poolSize <= 0) return 0;
    const current = this.providerCursors.get(providerId) ?? 0;
    const next = (current + 1) % poolSize;
    this.providerCursors.set(providerId, next);
    return current % poolSize;
  }

  public async recordMetrics(
    providerId: string,
    latencyMs: number,
    success: boolean,
    httpStatus?: number
  ): Promise<void> {
    const metrics = this.providerMetrics.get(providerId) || {
      totalCalls: 0,
      successCalls: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 400,
      consecutive5xx: 0,
      hostCooldownUntil: 0,
    };

    metrics.totalCalls += 1;
    if (success) {
      metrics.successCalls += 1;
      metrics.consecutive5xx = 0;
      metrics.totalLatencyMs += latencyMs;
      metrics.avgLatencyMs = Math.round(metrics.totalLatencyMs / metrics.successCalls);
    } else {
      if (httpStatus && httpStatus >= 500 && httpStatus <= 504) {
        metrics.consecutive5xx += 1;
      }
    }

    this.providerMetrics.set(providerId, metrics);
  }

  public async getMetrics(providerId: string): Promise<ProviderMetrics> {
    return (
      this.providerMetrics.get(providerId) || {
        totalCalls: 0,
        successCalls: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 400,
        consecutive5xx: 0,
        hostCooldownUntil: 0,
      }
    );
  }

  public async setModelUnavailable(
    providerId: string,
    modelId: string,
    unavailable: boolean
  ): Promise<void> {
    const key = `${providerId}:${modelId}`;
    if (unavailable) {
      this.unavailableModels.add(key);
    } else {
      this.unavailableModels.delete(key);
    }
  }

  public async isModelAvailable(providerId: string, modelId: string): Promise<boolean> {
    return !this.unavailableModels.has(`${providerId}:${modelId}`);
  }

  public async setHostCooldown(providerId: string, durationMs: number): Promise<void> {
    this.hostCooldowns.set(providerId, Date.now() + durationMs);
  }

  public async isHostInCooldown(providerId: string): Promise<boolean> {
    const until = this.hostCooldowns.get(providerId);
    if (!until) return false;
    if (Date.now() >= until) {
      this.hostCooldowns.delete(providerId);
      return false;
    }
    return true;
  }
}
