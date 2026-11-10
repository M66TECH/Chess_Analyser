// Worker wrapper pour Stockfish 19 WebAssembly
// Supporte les variantes standard et relaxed-simd avec file d'attente des commandes UCI.

const params = new URLSearchParams(self.location?.search || '');
const variant = params.get('variant') === 'standard' ? 'standard' : 'relaxed-simd';
const scriptFile = variant === 'relaxed-simd' ? 'sf_19_smallnet_relaxed-simd.js' : 'sf_19_smallnet.js';
const wasmFile = variant === 'relaxed-simd' ? 'sf_19_smallnet_relaxed-simd.wasm' : 'sf_19_smallnet.wasm';

let sf = null;
const queue = [];

self.onmessage = (event) => {
  const cmd = typeof event.data === 'string' ? event.data : '';
  if (!cmd) return;

  if (sf) {
    try {
      sf.uci(cmd);
    } catch (err) {
      console.error('[sf-worker] Erreur exécution UCI:', err);
    }
  } else {
    queue.push(cmd);
  }
};

(async () => {
  try {
    const mod = await import(`./${scriptFile}`);
    const initModule = mod.default || mod;

    sf = await initModule({
      locateFile: (file) => {
        if (file.endsWith('.wasm')) {
          return `/stockfish/${wasmFile}`;
        }
        return `/stockfish/${file}`;
      },
      listen: (line) => {
        self.postMessage(line);
      },
      onError: (err) => {
        console.warn('[sf-worker] stderr:', err);
      },
    });

    // Vider les commandes reçues pendant l'initialisation
    while (queue.length > 0) {
      const pendingCmd = queue.shift();
      sf.uci(pendingCmd);
    }
  } catch (err) {
    console.error('[sf-worker] Erreur initialisation Stockfish 19:', err);
    self.postMessage('engine-error ' + (err instanceof Error ? err.message : String(err)));
  }
})();
