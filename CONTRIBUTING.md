# Guide de Contribution — Chess Analyzer

Merci de contribuer à **Chess Analyzer** ! Ce document définit les normes de code, la doctrine de non-régression et les étapes pour soumettre une contribution.

---

## 1. Principes Fondamentaux

1. **Vérité Échiquéenne Absolue** : Aucune fonctionnalité esthétique ou d'interface ne peut justifier une approximation ou une hallucination échiquéenne.
2. **Étanchéité des 5 Couches (L1–L5)** : Respectez strictement le flux d'autorité défini dans [ARCHITECTURE.md](ARCHITECTURE.md). Le code de présentation (UI) ne calcule jamais de règles d'échecs, et le moteur d'explication IA ne décide jamais des classifications.
3. **Licence AGPL-3.0** : Tout code soumis est placé sous la licence `AGPL-3.0-only`.

---

## 2. Environnement de Développement

### Installation

```bash
git clone https://github.com/M66TECH/Chess_Analyser.git
cd Chess_Analyser
npm install
```

### Commandes usuelles

```bash
# Lancement de l'environnement de développement
npm run dev

# Exécution des tests dans les différents packages
npm --prefix packages/chess-core test
npm --prefix apps/web test
npm --prefix packages/ui test

# Vérification TypeScript
npx tsc -p apps/web/tsconfig.json --noEmit

# Vérification de la suite de tests adversariaux P0
npx tsx scripts/verify-v533-p0-adversarial.ts

# Build de production complet
npm --prefix apps/web run build
```

---

## 3. Workflow de Pull Request

1. **Créer une branche dédiée** : `git checkout -b fix/nom-du-bug` ou `git checkout -b feat/nom-de-la-fonctionnalite`.
2. **Une fiche = une intervention** : Ne mélangez pas refactoring de code et modification des algorithmes d'analyse.
3. **Couverture de tests systématique** : Tout correctif ou nouvelle fonctionnalité doit être accompagné d'un test unitaire ou d'intégration dans le paquet approprié.
4. **Vérification de non-régression** : Tous les 243+ tests unitaires existants et les 12 tests adversariaux doivent passer avec un taux de réussite de 100%.
5. **Formatage et typage** : Aucun `any` injustifié. Typage strict TypeScript obligatoire.
