# Vérité terrain du moteur Stockfish

Mesuré par `scripts/inspect-engine.mjs` (interrogation UCI directe, Node 22, vm).
Résultat brut : `docs/engine-probe.json`.

## Architecture adaptative Stockfish 19 (P2.11 — Implémenté)

La suite de moteurs est désormais adaptative via `EngineCapability.ts` et `public/stockfish/sf-worker.js` :
- **Stockfish 19 SmallNet Relaxed SIMD** (`sf_19_smallnet_relaxed-simd.js` + `.wasm`, ~544 Ko) : profil prioritaire pour navigateurs récents supportant WebAssembly vectoriel 128-bit et Module Workers. Gain mesuré de plus de 400 Elo par rapport au moteur historique 2019.
- **Stockfish 19 SmallNet Standard** (`sf_19_smallnet.js` + `.wasm`, ~545 Ko) : profil actif lorsque SIMD n'est pas supporté par le CPU/moteur JS.
- **Stockfish 10 Legacy** (`stockfish.js`, ~1.58 Mo) : repli de sécurité 100% autonome lorsque ni Module Worker ni WebAssembly moderne ne sont disponibles, ou en cas d'erreur de chargement inattendue.

## Constat sur le build actif de repli (apps/web/public/stockfish/stockfish.js)

- **Bannière : `Stockfish 2019-08-15 Multi-Variant`** (fork ddugovic, branche multi-variantes utilisée par Lichess à l'époque).
- Profondeur de recherche : fonctionne (depth 10 atteinte sur `startpos`).
- **Pré-NNUE** : antérieur à Stockfish 12 (première version NNUE, 2020). L'écart de force avec Stockfish 19 est de plusieurs centaines d'Elo.
- 16 options UCI déclarées, **dont** : `Threads`, `Hash`, `MultiPV`, `UCI_AnalyseMode`.
- **`Analysis Contempt` : ABSENT** — la commande `setoption name Analysis Contempt value Off` envoyée par `UCI_INIT_COMMANDS` (LichessUci.ts) est ignorée en silence par ce build. Sans conséquence comportementale (le contempt est déjà neutre en analyse), mais l'instruction est du bruit UCI : à retirer ou garder pour compatibilité avec un futur moteur.
- `Threads` est déclarée, mais sur un build asm.js mono-thread (~1,5 Mo, pas de pthreads), `Threads = 2` n'a très probablement aucun effet. À vérifier en navigateur (les P-threads exigent `crossOriginIsolated`, cf. `next.config.ts` COOP/COEP).

## Build mort identifié

- `stockfish.wasm.js` + `stockfish.wasm` (640 Ko) : **aucune référence dans le code** (0 occurrence), le loader échoue hors navigateur (`read is not defined`, loader Emscripten attendu côté web). `EngineManager` cible uniquement `/stockfish/stockfish.js`.
- Décision P0.2 : couple supprimé de `public/stockfish/` — 640 Ko de poids mort retirés du payload public.

## Implications (prioritisées dans le plan, P2 n°11)

- La conformité des **verdicts** (!?, ?, ??) dépend de la profondeur : ce build 2019 est moins rapide par nœud et moins fort par nœud — les seuils restent valides (ils dépendent de l'évaluation, pas de la force absolue), mais un upgrade vers `lichess-org/stockfish-web` (SF19) est le levier qualité n°1 du projet.
- `COOP/COEP credentialless` (actif globalement) ne sert ce build en rien (aucun pthread detecté) : conserver les en-têtes seulement si le futur build multithread l'exige, sinon ils coûtent (isolation des ressources tierces).

## Reproduire la mesure

```bash
node scripts/inspect-engine.mjs      # ~30 s, écrit docs/engine-probe.json
```
