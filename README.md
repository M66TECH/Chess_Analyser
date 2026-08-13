# Chess Analyzer — Coach IA d'échecs avancé ♟️

Analysez vos parties d'échecs avec **Stockfish 16.1 WASM** directement dans votre navigateur — sans serveur, sans latence.

## ✨ Fonctionnalités

- **Analyse Stockfish** — Moteur UCI WASM depth 14+, client-side
- **Coach IA** — Classification des coups (Brillant/Excellent/Bon/Erreur/Gaffe) avec formule Lichess
- **Détection tactique** — Fourchettes, clouages, pièces en prise
- **Heatmap** — Visualisation de la pression sur chaque case
- **Graphe d'évaluation** — Courbe cp/partie avec navigation interactive
- **Import PGN** — Chargez et analysez vos parties existantes
- **Design premium** — Dark glassmorphism, responsive mobile/desktop

## 🗂️ Architecture

```
chess_analyzer/
├── apps/
│   ├── web/          # Next.js 15 — UI React
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
npm run dev
```

L'application sera disponible sur [http://localhost:3000](http://localhost:3000).

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

- **Frontend** : Next.js 15, React 19, TailwindCSS 4
- **Moteur** : Stockfish 16.1 WASM (WebWorker)
- **Règles échecs** : chessops (Rust-compiled via WASM)
- **Échiquier** : chessground + react-chessground
- **Monorepo** : Turborepo + npm workspaces
- **Tests** : Vitest

## 📊 Statut de qualité

| Aspect | Statut |
|--------|--------|
| Bugs critiques | ✅ Corrigés (C1-C6) |
| Race conditions | ✅ Corrigées |
| Crash FEN invalide | ✅ Protégé |
| Import PGN | ✅ Implémenté |
| Fourchette reine | ✅ Corrigée |
| Layout mobile | ✅ Responsive |
| Tests unitaires | ✅ Configurés (vitest) |
| Error Boundaries | ✅ Ajoutés |
