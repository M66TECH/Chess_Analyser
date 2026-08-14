import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parseUci, makeUci } from 'chessops/util';
import { makeSan } from 'chessops/san';
import { MoveNode } from '../pedagogy/types';

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
    return Math.floor(path.length / 2) + 1;
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
  
  public getTree() {
    return {
      nodes: this.nodes,
      currentNodeId: this.currentNodeId,
      initialFen: this.initialFen
    };
  }
}
