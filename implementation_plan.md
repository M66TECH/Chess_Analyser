# Plan d'Implémentation : Échiquier d'Analyse Augmenté & Humanisé

Ce document détaille l'intégration des modules d'Humanisation (IA Générative) et de l'Arbre des Variantes interactif au sein de l'architecture existante de Chess Analyzer.

## Objectifs Principaux
1. **Module 3 (Humanisation & Pédagogie)** : Remplacer/enrichir les explications basées sur des règles par des explications textuelles fluides et stratégiques générées par LLM (Gemini API).
2. **Module 4 (Arbre de Navigation et Variantes)** : Supporter les sous-variantes pour tester des coups alternatifs sans perdre la partie principale.
3. **Backend IA** : Créer une API sécurisée pour masquer la clé API du LLM.

---

## 1. Backend IA (Next.js Route Handlers)

Le projet utilise Next.js (App Router). Nous allons utiliser les Route Handlers (API routes) de Next.js pour créer le "backend léger" mentionné dans le cahier des charges, évitant ainsi de devoir configurer et maintenir un serveur séparé (comme FastAPI).

### Actions :
- Créer une route d'API `/api/analyze` dans `apps/web/app/api/analyze/route.ts`.
- Intégrer le SDK Gemini (`@google/genai`).
- Définir un prompt système strict pour s'assurer que le LLM retourne des réponses concises (2 à 4 phrases), expliquant la stratégie, les tactiques, et les variantes secondaires.
- Inclure le niveau de langage (Débutant, Intermédiaire, Avancé) dans le prompt.

---

## 2. Module 3 : Humanisation & Pédagogie (IA)

Actuellement, `ExplanationEngine.ts` génère des phrases templates. Nous allons le modifier pour faire appel à l'API LLM.

### Actions :
- **LLMService** : Créer un service front-end dans `chess-core` qui appellera l'API `/api/analyze` de Next.js.
- **Niveau de Langage (F-10)** : Ajouter un état global (ex: `languageLevel`) dans le `GameManager` ou l'UI, modifiable via un sélecteur (Débutant / Intermédiaire / Avancé).
- **Intégration au Pipeline (F-08, F-09)** : 
  - Lorsque `AnalysisPipeline` reçoit l'évaluation finale d'un coup, au lieu de formater une phrase statique, il enverra les données (FEN, coup joué, évaluation, meilleure ligne PV, motifs tactiques) au `LLMService`.
  - Le `LLMService` renverra l'explication (qui couvre le coup principal et les alternatives si pertinent).
- **Mise en cache** : Mettre en cache les réponses du LLM pour un FEN donné + un coup donné pour réduire les coûts et la latence.

---

## 3. Module 4 : Arbre des Variantes et Sous-lignes (F-11, F-12)

C'est la partie logicielle la plus complexe. Actuellement, `MoveManager` maintient une simple liste linéaire (`moveHistory`). Nous devons passer à une structure arborescente (Nœuds).

### Actions :
- **Structure de Données** : Remplacer `MoveManager` par un `TreeMoveManager` (ou adapter l'existant) gérant une arborescence de type PGN (`Node` avec `children`, `parent`, `mainline`).
- **Logique de Branchement (F-12)** : 
  - Si un utilisateur joue un coup qui n'est pas dans l'historique actuel, créer un nouveau nœud (sous-variante).
  - Maintenir un "pointeur de navigation" (le nœud actuellement affiché).
- **UI de l'Arbre (F-11)** :
  - Mettre à jour `MoveList.tsx` pour afficher les lignes secondaires entre parenthèses ou de manière indentée.
  - Permettre de cliquer sur n'importe quel nœud pour y revenir.
- **GameManager** : Adapter la gestion des événements (`PositionChanged`, `MovePlayed`) pour supporter cette structure arborescente.

---

## 4. Interface Utilisateur (UI)

- **Sélecteur de Niveau IA** : Ajouter un menu déroulant ou des boutons (Débutant/Intermédiaire/Avancé) dans le panel "Coach".
- **Affichage des Explications** : Remplacer le texte généré par l'ancien `ExplanationEngine` par un composant affichant l'analyse LLM, avec un indicateur de chargement (le LLM prend ~1 seconde à répondre).
- **Composant MoveTree** : Remplacer l'ancienne liste linéaire par un composant d'arbre de variantes propre (similaire à Lichess).

---

## ⚠️ Questions Ouvertes et Validation (User Review Required)

> [!WARNING]  
> **Backend LLM :**
> L'utilisation de Next.js API Routes est la solution la plus élégante et s'intègre parfaitement à l'existant. Cela vous convient-il de rester sur Node.js/Next.js au lieu de créer un backend séparé en Python FastAPI ?

> [!IMPORTANT]  
> **Clé API Gemini :**
> Le LLM nécessitera une clé API valide (`GEMINI_API_KEY`). Je vais préparer le code pour lire cette variable d'environnement. Avez-vous une clé à disposition pour que l'application fonctionne ?

> [!TIP]  
> **Arbre des Variantes :**
> La gestion des variantes (sous-lignes) demande une refonte profonde du `MoveManager`. L'UI de la liste de coups devra aussi changer pour supporter l'indentation des variantes. Acceptez-vous ces changements majeurs sur l'historique ?

Veuillez valider cette approche ou indiquer si vous préférez des ajustements avant que je ne commence l'implémentation.
