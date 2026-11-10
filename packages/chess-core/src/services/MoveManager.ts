import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parseSquare, parseUci, makeUci } from 'chessops/util';
import { makeSan } from 'chessops/san';
import { MoveNode } from '../pedagogy/types';

/** Pièces proposées lors d'une promotion, dans l'ordre de l'UI. */
const PROMOTION_ROLES = ['q', 'r', 'b', 'n'] as const;

export class MoveManager {
  private initialFen: string;
  private pos: Chess;
  
  // Tree state
  private nodes: Map<string, MoveNode> = new Map();
  private currentNodeId: string | null = null; // null = initial position
  private nextId: number = 1;

  constructor(fen?: string) {
    if (fen) {
      try {
        const parsed = parseFen(fen).unwrap();
        this.pos = Chess.fromSetup(parsed).unwrap();
      } catch {
        console.warn('[MoveManager] FEN invalide, position initiale utilisée:', fen);
        this.pos = Chess.default();
      }
    } else {
      this.pos = Chess.default();
    }
    this.initialFen = makeFen(this.pos.toSetup());
  }

  public getInitialFen(): string {
    return this.initialFen;
  }

  public getFen(): string {
    return makeFen(this.pos.toSetup());
  }

  // Linear history of the current path (Mainline or active variation)
  public getUciMoves(): string[] {
    const path = this.getCurrentPath();
    return path.map(n => n.uci);
  }

  public getSanMoves(): string[] {
    const path = this.getCurrentPath();
    return path.map(n => n.san);
  }

  public getMoveCount(): number {
    return this.getCurrentPath().length;
  }

  public getCurrentMoveNumber(): number {
    const path = this.getCurrentPath();
    return Math.ceil(path.length / 2);
  }

  /** Retourne la liste ordonnée des nœuds de la branche active (racine → position courante). */
  public getHistory(): MoveNode[] {
    return this.getCurrentPath();
  }

  /**
   * Détecte si la position courante (placement + trait + droits de roque + ep)
   * est apparue au moins 3 fois dans la branche courante (nulle par répétition).
   */
  public isThreefoldRepetition(): boolean {
    const keyOf = (fen: string) => fen.split(' ').slice(0, 4).join(' ');
    const path = this.getCurrentPath();
    const targetKey = keyOf(this.getFen());
    let count = keyOf(this.initialFen) === targetKey ? 1 : 0;
    for (const node of path) {
      if (keyOf(node.fenAfter) === targetKey) {
        count++;
      }
    }
    return count >= 3;
  }

  /**
   * Remonte jusqu'au dernier coup irréversible (coup de pion, prise ou roque,
   * où l'horloge des demi-coups `halfmoves` retombe à 0) pour permettre à
   * Stockfish de détecter les nulles par répétition (`ceval/ctrl.ts` de Lila).
   *
   * ⚠ Convention de la fenêtre : `halfmoves === 0` **après** le coup `i`
   * signifie que le coup `i` est irréversible. La racine envoyée est donc la
   * position **avant** ce coup (`path[i].fenBefore`), et la liste de coups
   * commence **à** ce coup (`path.slice(i)`). Rejouer `path.slice(i + 1)`
   * depuis `path[i].fenAfter` dupliquerait le coup et perdrait la position
   * avant le coup — c'est ce que faisait la version précédente.
   */
  public getIrreversibleHistory(): { rootFen: string; moves: string[] } {
    const path = this.getCurrentPath();
    if (path.length === 0) {
      return { rootFen: this.initialFen, moves: [] };
    }

    // Dernier coup irréversible de la branche (le plus récent).
    let lastIrreversible = -1;
    for (let i = path.length - 1; i >= 0; i--) {
      const halfmoves = parseInt(path[i].fenAfter.split(' ')[4] ?? '0', 10);
      if (halfmoves === 0) {
        lastIrreversible = i;
        break;
      }
    }

    if (lastIrreversible === -1) {
      // Aucun coup irréversible : toute la branche depuis la position initiale.
      return { rootFen: this.initialFen, moves: path.map(n => n.uci) };
    }

    const rootFen = path[lastIrreversible].fenBefore;
    const moves = path.slice(lastIrreversible).map(n => n.uci);
    return { rootFen, moves };
  }

  private getCurrentPath(): MoveNode[] {
    const path: MoveNode[] = [];
    let current = this.currentNodeId ? this.nodes.get(this.currentNodeId) : null;
    while (current) {
      path.unshift(current);
      current = current.parentId ? this.nodes.get(current.parentId) : null;
    }
    return path;
  }

  public playMove(uci: string): { success: boolean; san?: string; fenBefore?: string; nodeId?: string } {
    let move = parseUci(uci);
    if (!move) return { success: false };

    const fenBefore = this.getFen();

    if (!this.pos.isLegal(move)) {
      // Promotion notée sans pièce (`e7e8`) : on choisit la dame, convention
      // des PGN abrégés. L'UI, elle, passe toujours par `isPromotion()` pour
      // laisser le joueur choisir avant d'envoyer le coup.
      const promotionMove = parseUci(uci + 'q');
      if (promotionMove && this.pos.isLegal(promotionMove)) {
        move = promotionMove;
      } else {
        return { success: false };
      }
    }

    const san = makeSan(this.pos, move);
    
    // Check if move already exists as a child
    const parentId = this.currentNodeId;
    let existingChildId: string | null = null;
    if (parentId) {
      const parentNode = this.nodes.get(parentId);
      if (parentNode) {
        for (const childId of parentNode.childrenIds) {
          const child = this.nodes.get(childId);
          if (child && child.uci === makeUci(move)) {
            existingChildId = childId;
            break;
          }
        }
      }
    } else {
      // Root children check
      for (const node of this.nodes.values()) {
        if (node.parentId === null && node.uci === makeUci(move)) {
          existingChildId = node.id;
          break;
        }
      }
    }

    if (existingChildId) {
      // Re-use existing node (Variant navigation)
      this.currentNodeId = existingChildId;
      this.pos.play(move);
      return { success: true, san, fenBefore, nodeId: existingChildId };
    }

    // Create new node
    const turnColor = this.pos.turn === 'white' ? 'white' : 'black';
    const moveNumber = this.pos.turn === 'white' ? this.pos.fullmoves : this.pos.fullmoves;
    
    this.pos.play(move);
    const fenAfter = this.getFen();
    
    // Si c'est le premier enfant du parent, il devient mainline du parent (si le parent est mainline ou root)
    const isParentMainline = parentId ? (this.nodes.get(parentId)?.isMainline ?? false) : true;
    const parentHasChildren = parentId ? (this.nodes.get(parentId)?.childrenIds.length ?? 0) > 0 : Array.from(this.nodes.values()).some(n => n.parentId === null);
    
    const isMainline = isParentMainline && !parentHasChildren;

    const newNode: MoveNode = {
      id: `node_${this.nextId++}`,
      uci: makeUci(move),
      san,
      fenBefore,
      fenAfter,
      moveNumber,
      color: turnColor,
      parentId,
      childrenIds: [],
      isMainline
    };

    this.nodes.set(newNode.id, newNode);
    
    if (parentId) {
      const parentNode = this.nodes.get(parentId);
      if (parentNode) {
        parentNode.childrenIds.push(newNode.id);
      }
    }

    this.currentNodeId = newNode.id;

    return { success: true, san, fenBefore, nodeId: newNode.id };
  }

  public getPosition(): Chess {
    return this.pos.clone();
  }

  /**
   * Vrai si `from`→`to` nécessite un choix de pièce de promotion.
   *
   * Sert à l'UI : elle doit ouvrir le sélecteur avant de jouer le coup, car
   * `playMove` exige la pièce dans l'UCI (`e7e8q`). Se base sur les coups
   * réellement légaux plutôt que sur une heuristique de rangée.
   */
  public isPromotion(from: string, to: string): boolean {
    const fromSquare = parseSquare(from);
    const toSquare = parseSquare(to);
    if (fromSquare === undefined || toSquare === undefined) return false;

    const piece = this.pos.board.get(fromSquare);
    if (!piece || piece.role !== 'pawn') return false;

    const base = parseUci(`${from}${to}`);
    if (base && this.pos.isLegal(base)) return false; // pas une promotion

    // Promotion si au moins une pièce rend le coup légal.
    return PROMOTION_ROLES.some(role => {
      const move = parseUci(`${from}${to}${role}`);
      return move ? this.pos.isLegal(move) : false;
    });
  }

  // FEN history of current path
  public getFenAtIndex(index: number): string | null {
    if (index === 0) return this.initialFen;
    const path = this.getCurrentPath();
    if (index > path.length || index < 0) return null;
    return path[index - 1].fenAfter;
  }

  // Navigate to a specific node by ID
  public goToNode(nodeId: string | null): boolean {
    if (nodeId === null) {
      this.resetToInitial();
      return true;
    }

    if (!this.nodes.has(nodeId)) return false;

    // Reconstruct position from root
    this.resetToInitial();
    const targetNode = this.nodes.get(nodeId)!;
    
    // Find path to target
    const path: MoveNode[] = [];
    let current: MoveNode | null = targetNode;
    while (current) {
      path.unshift(current);
      current = current.parentId ? this.nodes.get(current.parentId) || null : null;
    }

    // Play all moves
    for (const node of path) {
      const move = parseUci(node.uci);
      if (move) this.pos.play(move);
    }
    this.currentNodeId = nodeId;
    return true;
  }
  
  private resetToInitial() {
    try {
      const parsed = parseFen(this.initialFen).unwrap();
      this.pos = Chess.fromSetup(parsed).unwrap();
    } catch {
      this.pos = Chess.default();
    }
    this.currentNodeId = null;
  }

  public reset(fen?: string) {
    if (fen) {
      try {
        const parsed = parseFen(fen).unwrap();
        this.pos = Chess.fromSetup(parsed).unwrap();
      } catch {
        console.warn('[MoveManager] FEN invalide dans reset(), position initiale utilisée:', fen);
        this.pos = Chess.default();
      }
    } else {
      this.pos = Chess.default();
    }
    this.initialFen = makeFen(this.pos.toSetup());
    this.nodes.clear();
    this.currentNodeId = null;
    this.nextId = 1;
  }

  public getUciMovesString(): string {
    return this.getUciMoves().join(' ');
  }

  /**
   * Importe un ensemble de nœuds pour former un arbre de coups (Lot 3).
   * Reconstitue la position courante et réajuste le compteur d'identifiants.
   */
  public importTree(
    nodes: Map<string, MoveNode> | MoveNode[],
    initialFen?: string,
    currentNodeId?: string | null
  ): void {
    if (initialFen) {
      try {
        const parsed = parseFen(initialFen).unwrap();
        this.pos = Chess.fromSetup(parsed).unwrap();
        this.initialFen = initialFen;
      } catch {
        this.pos = Chess.default();
        this.initialFen = makeFen(this.pos.toSetup());
      }
    } else {
      this.resetToInitial();
    }

    this.nodes.clear();
    let maxId = 0;

    const list = nodes instanceof Map ? Array.from(nodes.values()) : nodes;
    for (const node of list) {
      this.nodes.set(node.id, { ...node, childrenIds: [...node.childrenIds] });
      const match = node.id.match(/(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxId) maxId = num;
      }
    }
    this.nextId = maxId + 1;

    if (currentNodeId !== undefined) {
      this.goToNode(currentNodeId);
    } else {
      const mainline = Array.from(this.nodes.values()).filter((n) => n.isMainline);
      if (mainline.length > 0) {
        this.goToNode(mainline[mainline.length - 1].id);
      } else {
        this.resetToInitial();
      }
    }
  }
  
  public getTree() {
    return {
      nodes: this.nodes,
      currentNodeId: this.currentNodeId,
      initialFen: this.initialFen
    };
  }
}
