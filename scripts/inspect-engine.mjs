#!/usr/bin/env node
/**
 * Interroge les builds Stockfish présents dans apps/web/public/stockfish
 * via le protocole UCI, en dehors du navigateur.
 *
 * Les builds Emscripten « worker » attendent un contexte self/postMessage :
 * on les évalue dans un univers vm avec ces shims, puis on injecte uci / isready
 * et on consigne bannières, options et disponibilité.
 *
 * Usage : node scripts/inspect-engine.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'apps/web/public/stockfish');

const DEFAULT_TIMEOUT_MS = 60000;

function probe(buildFile, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const source = fs.readFileSync(path.join(DIR, buildFile), 'utf8');

  return new Promise((resolve) => {
    const lines = [];
    const queue = [];
    let onMessageHandler = null;

    const flush = () => {
      while (queue.length > 0) {
        const ev = queue.shift();
        if (typeof onMessageHandler === 'function') onMessageHandler(ev);
      }
    };

    const sandbox = {};
    const makeSandbox = () => {
      sandbox.postMessage = (data) => {
        const line = typeof data === 'string' ? data : String(data);
        lines.push(line);
      };
      sandbox.self = sandbox;
      sandbox.globalThis = sandbox;
      sandbox.setTimeout = setTimeout;
      sandbox.clearTimeout = clearTimeout;
      sandbox.setInterval = setInterval;
      sandbox.clearInterval = clearInterval;
      sandbox.console = { log: () => {}, error: () => {}, warn: () => {} };
      sandbox.location = { href: 'file:///' };
      sandbox.performance = performance;
      return sandbox;
    };

    makeSandbox();
    Object.defineProperty(sandbox, 'onmessage', {
      configurable: true,
      get: () => onMessageHandler,
      set: (v) => { onMessageHandler = v; flush(); },
    });

    try {
      const script = new vm.Script(source, { filename: buildFile });
      script.runInNewContext(sandbox, { timeout: timeoutMs });
    } catch (err) {
      resolve({ file: buildFile, error: String(err).slice(0, 300) });
      return;
    }

    // Le build définit self.onmessage une fois Emscripten initialisé.
    const waitFor = (predicate, then) => {
      const started = Date.now();
      const tick = () => {
        if (predicate()) { then(); return; }
        if (Date.now() - started > timeoutMs) {
          resolve({ file: buildFile, error: 'timeout pendant initialisation', partial: lines });
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    };

    queue.push({ data: 'uci' });
    flush();

    waitFor(
      () => lines.some((l) => l.includes('uciok')),
      () => {
        queue.push({ data: 'isready' });
        flush();
        waitFor(
          () => lines.some((l) => l.includes('readyok')),
          () => {
            const banner = lines.find((l) => l.startsWith('id name'))?.slice('id name '.length);
            const options = lines
              .filter((l) => l.startsWith('option name'))
              .map((l) => {
                const m = l.match(/option name (\S+) type (\S+)/);
                return m ? `${m[1]} (${m[2]})` : l;
              });
            // Test position + évaluation minimale pour vérifier que la recherche fonctionne.
            queue.push({ data: 'position startpos' });
            queue.push({ data: 'go depth 10' });
            flush();
            waitFor(
              () => lines.some((l) => l.startsWith('bestmove')),
              () => {
                const depth = Math.max(
                  ...lines.map((l) => {
                    const m = l.match(/depth (\d+)/);
                    return m ? parseInt(m[1], 10) : 0;
                  })
                );
                resolve({ file: buildFile, banner, options, reachedDepth: depth, ok: true });
              }
            );
          }
        );
      }
    );
  });
}

const résultats = [];
const fichiers = ['stockfish.js', 'stockfish.wasm.js'].filter((f) => fs.existsSync(path.join(DIR, f)));

for (const fichier of fichiers) {
  process.stdout.write(`\n=== ${fichier} ===\n`);
  const résultat = await probe(fichier);
  if (résultat.error) {
    process.stdout.write(`ÉCHEC : ${résultat.error}\n`);
    if (résultat.partial?.length) {
      process.stdout.write(`  lignes captées : ${résultat.partial.length} (première : ${résultat.partial[0]?.slice(0, 60)})\n`);
    }
  } else {
    process.stdout.write(`Bannière : ${résultat.banner ?? 'non transmise'}\n`);
    process.stdout.write(`Profondeur atteinte : ${résultat.reachedDepth}\n`);
    process.stdout.write(`Nombre d'options UCI : ${résultat.options.length}\n`);
    const labeled = ['Threads', 'Hash', 'MultiPV', 'UCI_AnalyseMode', 'Analysis Contempt'];
    for (const opt of labeled) {
      process.stdout.write(`  ${opt} : ${résultat.options.some((o) => o.startsWith(opt + ' ')) ? 'supporté' : 'ABSENT'}\n`);
    }
  }
  résultats.push(résultat);
}

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'engine-probe.json'), JSON.stringify(résultats, null, 2));
process.stdout.write('\nRésultats bruts : docs/engine-probe.json\n');
