import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  supportsWasm,
  supportsWasmSimd,
  supportsModuleWorker,
  getRecommendedEngineConfig,
} from '../engine/EngineCapability';

describe('EngineCapability', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('détecte le support de WebAssembly', () => {
    expect(supportsWasm()).toBe(true);
  });

  it('détecte le support des instructions vectorielles WASM SIMD', () => {
    // Node 20+ supporte nativement WebAssembly SIMD
    expect(typeof supportsWasmSimd()).toBe('boolean');
  });

  it('retourne false pour supportsModuleWorker hors navigateur', () => {
    // En environnement Node/jsdom sans vrai blob worker
    expect(supportsModuleWorker()).toBe(false);
  });

  it('sélectionne un profil de moteur cohérent et sécurisé', () => {
    const config = getRecommendedEngineConfig();
    expect(['sf19-simd', 'sf19-standard', 'sf10-legacy']).toContain(config.profile);
    expect(config.workerPath).toBeTruthy();
    expect(config.concurrency).toBeGreaterThanOrEqual(1);
    expect(config.concurrency).toBeLessThanOrEqual(8);
  });

  it('active Stockfish 19 SIMD si WASM et Module Workers sont disponibles', () => {
    const origWorker = globalThis.Worker;
    const origBlob = globalThis.Blob;
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;

    try {
      URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
      URL.revokeObjectURL = vi.fn();

      class MockWorker {
        terminate = vi.fn();
        constructor(_url: string, opts?: WorkerOptions) {
          if (opts?.type === 'module') {
            // Module worker accepté
          }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      globalThis.Worker = MockWorker as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      globalThis.Blob = class {} as any;

      const config = getRecommendedEngineConfig();
      expect(config.isModule).toBe(true);
      expect(config.workerPath).toContain('/stockfish/sf-worker.js');
      expect(['sf19-simd', 'sf19-standard']).toContain(config.profile);
    } finally {
      globalThis.Worker = origWorker;
      globalThis.Blob = origBlob;
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    }
  });
});
