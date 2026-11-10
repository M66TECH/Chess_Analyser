# Third-Party Notices

Ce projet intègre des composants tiers. Les licences suivantes s'appliquent.

## Composants intégrés au bundle

| Composant | Licence | Usage |
|---|---|---|
| [Stockfish](https://stockfishchess.org) (moteur, build WASM/JS) | GPL-3.0 | Moteur d'analyse, servi au navigateur depuis `apps/web/public/stockfish/` |
| [chessops](https://github.com/niklasf/chessops) | GPL-3.0 | Règles d'échecs, FEN/SAN/PGN, bitboards |
| [chessground](https://github.com/lichess-org/chessground) | GPL-3.0 | Rendu de l'échiquier |
| Font Awesome (`@fortawesome/*`) | MIT (icons CC BY 4.0) | Icônes SVG |

## Services distants appelés

| Service | Nature des données transmises |
|---|---|
| Lichess (Opening Explorer, Tablebase Syzygy, Cloud Eval) | FEN de la position courante. Nécessite un jeton d'API configuré côté serveur (`LICHESS_TOKEN`). |
| Passerelle LLM (`RIVER_API_KEY`, route `/api/coach`) | FEN, coups joués au format moteur, faits tactiques — jamais de données personnelles. |

## Remerciements et alignement

Les formules d'analyse (précision, jugement des coups, chances de gain) sont alignées
sur le code de [lila](https://github.com/lichess-org/lila) (AGPL-3.0) et
[scalachess](https://github.com/lichess-org/scalachess) (GPL-3.0). Le projet respecte
les termes de ces licences : Chess Analyzer est distribué sous GPL-3.0.

Le clone de lecture `clone lichess/` est exclu du suivi git ; il ne fait pas partie
du code distribué.
