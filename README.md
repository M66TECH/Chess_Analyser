# Chess Analyzer — Coach IA d'échecs universel ♟️

[![Licence: AGPL-3.0](https://img.shields.io/badge/Licence-AGPL--3.0-blue.svg)](LICENSE)
[![Tests: 243 passed](https://img.shields.io/badge/Tests-243%20pass%C3%A9s%20(100%25)-brightgreen.svg)]()
[![P0 Adversarial: 12/12](https://img.shields.io/badge/P0%20Adversarial-12%2F12%20certifi%C3%A9s-emerald.svg)]()
[![Engine: Stockfish 19 WASM](https://img.shields.io/badge/Moteur-Stockfish%2019%20WASM-orange.svg)]()

Plateforme universelle d'analyse échiquéenne pédagogique propulsée par **Stockfish 19 WASM**, la classification officielle de **Lichess (`lila`)** et un **Coach IA factuellement certifié** (garantie zéro-hallucination).

---

## ✨ Fonctionnalités phares

- **Vérité Échiquéenne Certifiée (L1–L4)** : Architecture en 5 couches d'autorité. Les affirmations du coach IA sont contrôlées contre les faits géométriques réels (`VerifiedTacticalFacts`) avec repli déterministe immédiat en cas d'incohérence.
- **Moteur Stockfish 19 WASM** : Analyse locale dans le navigateur jusqu'à la profondeur cible (18+), avec pré-chargement asynchrone depuis le Cloud Eval Lichess.
- **Classification Lichess Complète** : 9 jugements officiels (`!!` brillant, `!` remarquable, meilleur coup, excellent, bon, théorique, `?!` imprécision, `?` erreur, `??` gaffe).
- **Arbre de Variantes RAV Intégral** : Navigation arborescente dans les variantes (`MoveTree`) et import PGN bilingue (français `C, F, T, D, R` et international `N, B, R, Q, K`).
- **Puzzles & Défi à 3 Indices Progressifs (O18/A31)** : Entraînement tactique sur les gaffes de la partie avec graduation de l'aide :
  1. *Indice 1* : Case de départ de la bonne pièce.
  2. *Indice 2* : Motif tactique clé (clouage, pièce non défendue, attaque de mat).
  3. *Indice 3* : Solution complète avec flèche sur l'échiquier.
- **Niveau Pédagogique Adaptatif (O15)** : Sélecteur segmenté (*Débutant*, *Intermédiaire*, *Avancé*) dans la barre de navigation, avec vocabulaire et explications sur-mesure.
- **Performance Zéro-Lag (O4/O20)** : Isolation de l'échiquier via `hoverStore` (`useSyncExternalStore`) : 0 re-render de la page au survol des insights.
- **Persistance & Hygiène (O14)** : Sauvegarde locale automatique de la partie (`ca:game:v1`) et des préférences utilisateur (`ca:prefs` : niveau, orientation, son).

---

## 🏛️ Architecture en 5 Couches d'Autorité

Pour garantir qu'aucune hallucination d'IA ne puisse tromper l'utilisateur :

| Couche | Responsabilité | Composants clés |
| :--- | :--- | :--- |
| **L1 — Moteur & Nuage** | Calcul brut des évaluations et variantes principales (POV trait) | Stockfish 19 WASM, `CloudEvalService` |
| **L2 — Géométrie & Faits** | Faits vérifiables : coups légaux, échecs, mats, clouages, pièces en prise | `chessops`, `MotifEngine`, `VerifiedTacticalFacts` |
| **L3 — Jugement & Classification** | Qualification échiquéenne objective selon les règles strictes de Lichess | `MoveClassifier`, `LichessAccuracy`, `BrilliancyEngine` |
| **L4 — Formulation Pédagogique** | Traduction en langage naturel français et validation sémantique stricte | `ExplanationEngine`, `RiverAPI`, validateur factuel |
| **L5 — Présentation & Ergonomie** | Rendu graphique réactif, accessibilité et interaction sans latence | `@chess-analyzer/ui`, Next.js 16, `hoverStore` |

Consultez [ARCHITECTURE.md](ARCHITECTURE.md) pour les diagrammes de séquence et le modèle détaillé.

---

## 🚀 Démarrage rapide

### Prérequis
- Node.js 20+
- npm 10+

### Installation

```bash
git clone https://github.com/M66TECH/Chess_Analyser.git
cd Chess_Analyser
npm install
```

### Configuration des variables d'environnement

Créez le fichier `apps/web/.env.local` :

```env
# Clé d'API du fournisseur LLM (Groq, OpenRouter ou compatible OpenAI)
AI_GATEWAY_API_KEY="votre_cle_api"
AI_GATEWAY_MODEL="llama-3.3-70b-versatile"
AI_GATEWAY_PROVIDER="groq"

# Jeton Lichess pour l'Opening Explorer et le Cloud Eval
LICHESS_TOKEN=""
```

### Lancement en développement

```bash
npm run dev
```

L'application est accessible sur [http://localhost:3000](http://localhost:3000).

---

## 🧪 Tests & Assurance Qualité

Le projet applique une doctrine de **zéro-régression** avec 100% de succès exigé :

```bash
# Lancer les tests unitaires et d'intégration de chess-core (215 tests)
npm --prefix packages/chess-core test

# Lancer les tests de l'application Web (15 tests)
npm --prefix apps/web test

# Lancer les tests des composants UI (13 tests)
npm --prefix packages/ui test

# Lancer la suite de 12 tests adversariaux échiquéens P0
npx tsx scripts/verify-v533-p0-adversarial.ts
```

---

## ⌨️ Raccourcis clavier

| Touche | Action |
| :---: | :--- |
| `←` | Coup précédent |
| `→` | Coup suivant |
| `Home` | Début de la partie |
| `End` | Dernier coup joué |
| `F` | Retourner l'échiquier (mémorisé dans `ca:prefs`) |
| `?` | Ouvrir le guide et la liste des raccourcis |
| `Esc` | Fermer les fenêtres modales et quitter le mode défi |

---

## 📜 Licence

Ce projet est distribué sous licence **GNU Affero General Public License v3.0** (`AGPL-3.0-only`) en conformité avec les sources du serveur Lichess (`lila`). Voir [LICENSE](LICENSE) pour le texte intégral.
