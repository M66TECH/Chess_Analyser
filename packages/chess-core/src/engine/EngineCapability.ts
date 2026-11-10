/**
 * Détection des capacités d'exécution WebAssembly et sélection adaptative
 * du profil Stockfish optimal (Stockfish 19 SIMD, SF19 Standard, ou repli SF10).
 */

export type EngineProfile = 'sf19-simd' | 'sf19-standard' | 'sf10-legacy';

export interface EngineConfig {
  profile: EngineProfile;
  workerPath: string;
  isModule: boolean;
  simd: boolean;
  concurrency: number;
  engineName: string;
}

/**
 * Bytecode WASM minimal testant l'instruction v128.const (WebAssembly SIMD proposal).
 */
const SIMD_BYTECODE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
  0x03, 0x02, 0x01, 0x00,
  0x0a, 0x16, 0x01, 0x14, 0x00,
  0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x0b,
]);

/**
 * Vérifie si l'environnement supporte l'API WebAssembly de base.
 */
export function supportsWasm(): boolean {
  return typeof WebAssembly === 'object' && typeof WebAssembly.validate === 'function';
}

/**
 * Vérifie si le moteur JS supporte les instructions vectorielles WebAssembly SIMD (128-bit).
 */
export function supportsWasmSimd(): boolean {
  if (!supportsWasm()) return false;
  try {
    return WebAssembly.validate(SIMD_BYTECODE);
  } catch {
    return false;
  }
}

/**
 * Vérifie si le support des Module Workers est disponible.
 */
export function supportsModuleWorker(): boolean {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    return false;
  }
  let supported = false;
  const tester = {
    get type() {
      supported = true;
      return 'module';
    },
  };
  try {
    // Blob worker minimal pour tester l'option type sans faire de requête réseau
    const blob = new Blob([''], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const worker = new Worker(url, tester as any);
    worker.terminate?.();
    URL.revokeObjectURL(url);
  } catch {
    supported = false;
  }
  return supported;
}

/**
 * Calcule la configuration optimale pour le moteur Stockfish selon les capacités détectées.
 */
export function getRecommendedEngineConfig(): EngineConfig {
  const hasWasm = supportsWasm();
  const hasSimd = supportsWasmSimd();
  const hasModuleWorker = supportsModuleWorker();

  const rawConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  const concurrency = Math.min(8, Math.max(1, rawConcurrency));

  // Si Module Worker + WASM sont disponibles, on utilise Stockfish 19
  if (hasWasm && hasModuleWorker) {
    if (hasSimd) {
      return {
        profile: 'sf19-simd',
        workerPath: '/stockfish/sf-worker.js?variant=relaxed-simd',
        isModule: true,
        simd: true,
        concurrency,
        engineName: 'Stockfish 19 (SIMD)',
      };
    }
    return {
      profile: 'sf19-standard',
      workerPath: '/stockfish/sf-worker.js?variant=standard',
      isModule: true,
      simd: false,
      concurrency,
      engineName: 'Stockfish 19 (Standard)',
    };
  }

  // Repli sécurisé pour navigateurs plus anciens ou environnement sans Module Worker
  return {
    profile: 'sf10-legacy',
    workerPath: '/stockfish/stockfish.js',
    isModule: false,
    simd: false,
    concurrency: 1,
    engineName: 'Stockfish 10 (Repli)',
  };
}
