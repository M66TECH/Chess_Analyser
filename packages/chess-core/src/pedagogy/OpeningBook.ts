// ECO Opening Book — a compact subset of the most common openings
// Format: FEN prefix → { name, eco }
// We match by move sequence (UCI moves joined)

export interface OpeningEntry {
  eco: string;
  name: string;
  moves: string; // UCI moves string, space separated
}

const OPENINGS: OpeningEntry[] = [
  // A — Flank openings
  { eco: 'A00', name: "Ouverture Saragossa", moves: "c2c3" },
  { eco: 'A01', name: "Ouverture Nimzowitsch-Larsen", moves: "b2b3" },
  { eco: 'A04', name: "Attaque Réti", moves: "g1f3" },
  { eco: 'A10', name: "Ouverture Anglaise", moves: "c2c4" },
  { eco: 'A40', name: "Défense Polonaise", moves: "d2d4 b7b5" },
  // B — Semi-open games
  { eco: 'B00', name: "Défense B00", moves: "e2e4" },
  { eco: 'B01', name: "Défense Scandinave", moves: "e2e4 d7d5" },
  { eco: 'B02', name: "Défense Alekhine", moves: "e2e4 g8f6" },
  { eco: 'B10', name: "Défense Caro-Kann", moves: "e2e4 c7c6" },
  { eco: 'B12', name: "Caro-Kann — Variante d'Avance", moves: "e2e4 c7c6 d2d4 d7d5 e4e5" },
  { eco: 'B20', name: "Partie Sicilienne", moves: "e2e4 c7c5" },
  { eco: 'B21', name: "Sicilienne — Attaque Grand Prix", moves: "e2e4 c7c5 f2f4" },
  { eco: 'B22', name: "Sicilienne — Variante Alapin", moves: "e2e4 c7c5 c2c3" },
  { eco: 'B23', name: "Sicilienne — Variante Fermée", moves: "e2e4 c7c5 b1c3" },
  { eco: 'B27', name: "Sicilienne — Variante du Dragon", moves: "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 g7g6" },
  { eco: 'B30', name: "Sicilienne — Variante Scheveningen", moves: "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e6" },
  { eco: 'B40', name: "Sicilienne — Variante Kan", moves: "e2e4 c7c5 g1f3 e7e6" },
  { eco: 'B50', name: "Sicilienne sans 2.Nc3", moves: "e2e4 c7c5 g1f3 d7d6" },
  // C — Open games
  { eco: 'C00', name: "Partie Française", moves: "e2e4 e7e6" },
  { eco: 'C01', name: "Française — Variante d'Échange", moves: "e2e4 e7e6 d2d4 d7d5 e4d5 e6d5" },
  { eco: 'C02', name: "Française — Variante d'Avance", moves: "e2e4 e7e6 d2d4 d7d5 e4e5" },
  { eco: 'C10', name: "Française — Variante Rubinstein", moves: "e2e4 e7e6 d2d4 d7d5 b1c3 d5e4" },
  { eco: 'C20', name: "Partie du Roi — Variante du Centre", moves: "e2e4 e7e5" },
  { eco: 'C21', name: "Gambit Danois", moves: "e2e4 e7e5 d2d4" },
  { eco: 'C25', name: "Viennoise", moves: "e2e4 e7e5 b1c3" },
  { eco: 'C30', name: "Gambit du Roi", moves: "e2e4 e7e5 f2f4" },
  { eco: 'C40', name: "Défense Letton", moves: "e2e4 e7e5 g1f3 f7f5" },
  { eco: 'C41', name: "Défense Philidor", moves: "e2e4 e7e5 g1f3 d7d6" },
  { eco: 'C42', name: "Partie Russe (Défense Petroff)", moves: "e2e4 e7e5 g1f3 g8f6" },
  { eco: 'C44', name: "Ouverture Scotch — Gambit", moves: "e2e4 e7e5 g1f3 b8c6 d2d4" },
  { eco: 'C45', name: "Partie Écossaise", moves: "e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4" },
  { eco: 'C46', name: "Partie des Trois Cavaliers", moves: "e2e4 e7e5 g1f3 b8c6 b1c3" },
  { eco: 'C47', name: "Partie des Quatre Cavaliers", moves: "e2e4 e7e5 g1f3 b8c6 b1c3 g8f6" },
  { eco: 'C50', name: "Partie Italienne", moves: "e2e4 e7e5 g1f3 b8c6 f1c4" },
  { eco: 'C51', name: "Gambit Evans", moves: "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4" },
  { eco: 'C55', name: "Partie Italienne — Attaque Max Lange", moves: "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6" },
  { eco: 'C60', name: "Ruy Lopez", moves: "e2e4 e7e5 g1f3 b8c6 f1b5" },
  { eco: 'C61', name: "Ruy Lopez — Défense Bird", moves: "e2e4 e7e5 g1f3 b8c6 f1b5 b8d4" },
  { eco: 'C63', name: "Ruy Lopez — Variante Schliemann", moves: "e2e4 e7e5 g1f3 b8c6 f1b5 f7f5" },
  { eco: 'C65', name: "Ruy Lopez — Variante Berlin", moves: "e2e4 e7e5 g1f3 b8c6 f1b5 g8f6" },
  { eco: 'C68', name: "Ruy Lopez — Variante d'Échange", moves: "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5c6" },
  { eco: 'C70', name: "Ruy Lopez — Variante Morphy", moves: "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4" },
  { eco: 'C78', name: "Ruy Lopez — Variante Arkhangelsk", moves: "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8b4" },
  { eco: 'C80', name: "Ruy Lopez — Variante Ouverte", moves: "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f6e4" },
  { eco: 'C84', name: "Ruy Lopez — Variante Fermée", moves: "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7" },
  // D — Closed games
  { eco: 'D00', name: "Gambit de la Reine Refusé", moves: "d2d4 d7d5" },
  { eco: 'D01', name: "Attaque Richter-Veresov", moves: "d2d4 d7d5 b1c3 g8f6 c1g5" },
  { eco: 'D02', name: "Ouverture Londres", moves: "d2d4 d7d5 g1f3 g8f6 c1f4" },
  { eco: 'D06', name: "Gambit de la Reine", moves: "d2d4 d7d5 c2c4" },
  { eco: 'D10', name: "GDR — Défense Slave", moves: "d2d4 d7d5 c2c4 c7c6" },
  { eco: 'D20', name: "GDR — Gambit Accepté", moves: "d2d4 d7d5 c2c4 d5c4" },
  { eco: 'D30', name: "GDR Refusé", moves: "d2d4 d7d5 c2c4 e7e6" },
  { eco: 'D35', name: "GDR — Variante d'Échange", moves: "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c4d5 e6d5" },
  { eco: 'D43', name: "Semi-Slave", moves: "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 g1f3 c7c6" },
  { eco: 'D50', name: "GDR — Gambit Cambridge Springs", moves: "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 b8d7" },
  { eco: 'D70', name: "Défense Grünfeld", moves: "d2d4 g8f6 c2c4 g7g6 b1c3 d7d5" },
  { eco: 'D80', name: "Grünfeld — Variante Russe", moves: "d2d4 g8f6 c2c4 g7g6 b1c3 d7d5 c4d5 f6d5 e2e4 d5c3 b2c3" },
  // E — Indian systems
  { eco: 'E00', name: "Défense Catalane", moves: "d2d4 g8f6 c2c4 e7e6 g2g3" },
  { eco: 'E10', name: "Défense Nimzo-Indienne", moves: "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4" },
  { eco: 'E20', name: "Défense Nimzo-Indienne — Variante Classique", moves: "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4 d1c2" },
  { eco: 'E40', name: "Défense Nimzo-Indienne — Variante Rubinstein", moves: "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3" },
  { eco: 'E60', name: "Défense Indienne du Roi", moves: "d2d4 g8f6 c2c4 g7g6" },
  { eco: 'E62', name: "KID — Variante Classique", moves: "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e1g1" },
  { eco: 'E70', name: "KID — Attaque des Quatre Pions", moves: "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f4" },
  { eco: 'E80', name: "KID — Variante Sämisch", moves: "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f3" },
  { eco: 'E90', name: "KID — Variante Classique", moves: "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e1g1 f1e2" },
];

export class OpeningBook {
  /**
   * Given a list of UCI moves played so far, returns the longest matching opening.
   */
  public static lookup(uciMoves: string[]): OpeningEntry | null {
    const moveStr = uciMoves.join(' ');
    let bestMatch: OpeningEntry | null = null;
    let bestLen = 0;

    for (const entry of OPENINGS) {
      if (moveStr.startsWith(entry.moves) && entry.moves.length > bestLen) {
        bestMatch = entry;
        bestLen = entry.moves.length;
      }
    }

    return bestMatch;
  }

  public static isBookMove(uciMoves: string[]): boolean {
    return this.lookup(uciMoves) !== null;
  }
}
