# Chess Analyzer — Coach IA d'échecs avancé ♟️

Analysez vos parties d'échecs avec **Stockfish 16.1 WASM** directement dans votre navigateur — sans serveur, sans latence.

## ✨ Fonctionnalités

- **Analyse Stockfish** — Moteur UCI WASM depth 14+, client-side
- **Coach IA** — Chaîne de modèles River (GLM-5.3 → Nemotron-3.5 → DeepSeek-V4.1) avec repli automatique
- **Détection tactique** — Fourchettes, clouages, pièces en prise
- **Heatmap** — Visualisation de la pression sur chaque case
- **Graphe d'évaluation** — Courbe cp/partie avec navigation interactive
- **Import PGN** — Chargez et analysez vos parties existantes
- **Design premium** — Dark glassmorphism, responsive mobile/desktop

## 🗂️ Architecture

```
chess_analyzer/
├── apps/
│   ├── web/          # Next.js 16 — UI React
│   └── api/          # FastAPI (optionnel)
├── packages/
│   ├── chess-core/   # Moteur + pipeline d'analyse (TypeScript pur)
│   └── ui/           # Composants React (ChessBoard, EvalBar, etc.)
```

### Couches logiques (chess-core)
```
Engine (Stockfish UCI) → EventBus → AnalysisPipeline → Pedagogy → UI
```

## 🚀 Installation

```bash
npm install
cp apps/web/.env.example apps/web/.env.local   # puis renseignez vos clés
npm run dev
```

L'application sera disponible sur [http://localhost:3000](http://localhost:3000).

### 🔑 Clés API (jamais committées)

Les secrets vivent **uniquement** dans `apps/web/.env.local`, ignoré par git.

| Variable | Rôle |
|----------|------|
| `RIVER_API_KEY` | Clé du routeur River pour le coach IA (serveur uniquement) |
| `RIVER_MODELS` | Ordre de priorité : `GLM-5.3-Flash` → `Nemotron-3.5-Super` → `DeepSeek-V4.1-Flash` |
| `LICHESS_TOKEN` | Jeton Lichess, **obligatoire** : l'explorateur renvoie 401 sans lui |
| `LICHESS_EXPLORER_URL` | `https://explorer.lichess.ovh/masters` (maîtres) ou `/lichess` (toutes les parties) |

La clé n'est jamais exposée au navigateur : `page.tsx` appelle `/api/coach`, qui contacte la passerelle côté serveur et parcourt la liste de modèles jusqu'à obtenir une réponse.

### 📖 Théorie des ouvertures (base Lichess)

Avant de juger un coup, le pipeline interroge la base Lichess sur la position **avant** le coup :

- le coup fait partie de la théorie humaine → jamais classé imprécision/erreur/gaffe, même si Stockfish préfère autre chose ;
- le nom et le code ECO de l'ouverture sont affichés, avec le pourcentage de parties ;
- hors base (position inconnue ou trop peu de parties), l'analyse Stockfish reprend ses droits.

## 🧪 Tests

```bash
cd packages/chess-core
npm test           # vitest run (une fois)
npm run test:watch # mode watch
npm run test:coverage  # avec couverture de code
```

## ⌨️ Raccourcis clavier

| Touche | Action |
|--------|--------|
| `←` | Coup précédent |
| `→` | Coup suivant |
| `F` | Retourner l'échiquier |
| `Esc` | Fermer le modal |

## 🔧 Technologies

- **Frontend** : Next.js 16 (Turbopack), React 19, TailwindCSS 4
- **Moteur** : Stockfish 16.1 WASM (WebWorker)
- **Règles échecs** : chessops (Rust-compiled via WASM)
- **Échiquier** : chessground + react-chessground
- **Monorepo** : Turborepo + npm workspaces
- **Tests** : Vitest

## 📊 Statut de qualité

| Aspect | Statut |
|--------|--------|
| Évaluation avant coup | Corrigé — cache mémoire + IndexedDB, plus de `{cp: 0}` fabriqué (E1) |
| Course navigation / analyse | Corrigée — évaluations taguées par FEN et invalidées à la navigation (C2) |
| Import PGN | Corrigé — FEN de départ personnalisé, erreurs remontées dans l'UI |
| Classification `best` | Corrigée — `bestMove` provient de l'évaluation pré-coup |
| Crash FEN invalide | Protégé (MoveManager, PgnParser, ChessBoard) |
| Partie vide à 100 % | Corrigé — 0 % tant qu'aucun coup n'est analysé |
| Layout mobile | Responsive (grille adaptative) |
| Tests unitaires | 119 tests Vitest (chess-core) |
| Vérification | `tsc`, `eslint` et `next build` passent |

