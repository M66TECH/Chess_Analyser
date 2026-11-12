import React, { useRef, useEffect } from 'react';
import type { MoveNode, MoveRecord } from '@chess-analyzer/chess-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBookOpen } from '@fortawesome/free-solid-svg-icons';

export interface MoveTreeProps {
  nodes: Map<string, MoveNode>;
  records?: MoveRecord[];
  activeNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
}

const CLASSIFICATION_BADGE: Record<string, { label: React.ReactNode; tooltip: string; style: string }> = {
  blunder: { label: '??', tooltip: 'Gaffe (??)', style: 'text-red-400 bg-red-950/60 border-red-500/40' },
  mistake: { label: '?', tooltip: 'Erreur (?)', style: 'text-orange-400 bg-orange-950/60 border-orange-500/40' },
  inaccuracy: { label: '?!', tooltip: 'Imprécision (?!)', style: 'text-yellow-300 bg-yellow-950/60 border-yellow-500/40' },
  good: { label: '✓', tooltip: 'Bon coup', style: 'text-emerald-400 bg-emerald-950/60 border-emerald-500/40' },
  excellent: { label: '✓✓', tooltip: 'Excellent coup', style: 'text-teal-300 bg-teal-950/60 border-teal-500/40' },
  best: { label: '★', tooltip: 'Meilleur coup', style: 'text-emerald-300 bg-emerald-900/60 border-emerald-400/40' },
  great: { label: '!', tooltip: 'Superbe coup (!)', style: 'text-blue-300 bg-blue-950/60 border-blue-500/40' },
  brilliant: { label: '!!', tooltip: 'Coup brillant (!!)', style: 'text-teal-200 bg-teal-900/70 border-teal-400/50' },
  book: { label: <FontAwesomeIcon icon={faBookOpen} className="w-2.5 h-2.5" />, tooltip: 'Coup théorique', style: 'text-purple-300 bg-purple-950/60 border-purple-500/40' },
};

/**
 * Composant d'arbre de variantes accessible (Phase 8).
 * Structure WAI-ARIA : role="tree", role="treeitem", aria-level, aria-expanded.
 */
export const MoveTree: React.FC<MoveTreeProps> = ({
  nodes,
  records = [],
  activeNodeId,
  onSelectNode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  const recordsByNodeId = new Map<string, MoveRecord>();
  for (const r of records) {
    recordsByNodeId.set(r.nodeId, r);
  }

  // Scroll automatique sur le coup actif
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeNodeId]);

  if (!nodes || nodes.size === 0) {
    return (
      <div className="glass-panel rounded-xl p-4 w-full h-full flex flex-col items-center justify-center text-slate-500 text-sm">
        Aucun coup joué.
      </div>
    );
  }

  // Rendu récursif d'une branche
  const renderBranch = (nodeId: string, level: number = 1): React.ReactNode => {
    const node = nodes.get(nodeId);
    if (!node) return null;

    const isActive = node.id === activeNodeId;
    const record = recordsByNodeId.get(node.id);
    const badge = record ? CLASSIFICATION_BADGE[record.classification] : null;

    const hasSiblings = node.childrenIds.length > 1;
    const mainChildId = node.childrenIds[0];
    const alternativeChildIds = node.childrenIds.slice(1);

    const prefix = node.color === 'white' ? `${Math.floor(node.moveNumber)}.` : `${Math.floor(node.moveNumber)}...`;

    return (
      <div key={node.id} className="flex flex-col">
        {/* Ligne du coup */}
        <div className={`flex items-center gap-1.5 py-0.5 px-1.5 rounded transition-colors ${
          isActive ? 'bg-indigo-600/30 text-white font-bold ring-1 ring-indigo-500/50' : 'hover:bg-slate-800/60 text-slate-300'
        }`}
        style={{ paddingLeft: `${(level - 1) * 14 + 6}px` }}
        >
          <span className="text-[11px] text-slate-500 font-mono w-7 shrink-0 text-right">
            {prefix}
          </span>
          <button
            ref={isActive ? activeItemRef : undefined}
            role="treeitem"
            aria-selected={isActive}
            aria-level={level}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelectNode?.(node.id)}
            className="text-xs font-mono px-1 py-0.5 rounded hover:text-white transition-colors flex items-center gap-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <span>{node.san}</span>
            {badge ? (
              <span className={`text-[9px] px-1 rounded border font-sans font-bold ${badge.style}`} title={badge.tooltip}>
                {badge.label}
              </span>
            ) : !node.isMainline ? (
              <span className="text-[9px] text-slate-500 font-sans" title="Non analysé">
                ...
              </span>
            ) : null}
          </button>
        </div>

        {/* Continuation de la branche principale */}
        {mainChildId && renderBranch(mainChildId, level)}

        {/* Sous-variantes alternatives (branches enfants) */}
        {hasSiblings && (
          <div className="border-l border-slate-700/60 ml-4 my-1 pl-1 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase font-semibold text-indigo-400/80 px-1">
              Variante
            </span>
            {alternativeChildIds.map((altId) => renderBranch(altId, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootNodes = Array.from(nodes.values()).filter((n) => n.parentId === null);

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label="Arbre des coups et variantes de la partie"
      className="glass-panel rounded-xl p-2.5 w-full h-full overflow-y-auto custom-scrollbar flex flex-col gap-1 text-xs"
    >
      <div className="flex items-center justify-between px-2 pb-2 border-b border-slate-800 text-[11px] font-semibold text-slate-400">
        <span>Arbre des variantes</span>
        <span className="text-[10px] text-slate-500 font-mono">{nodes.size} coups</span>
      </div>
      <div className="pt-1">
        {rootNodes.map((root) => renderBranch(root.id, 1))}
      </div>
    </div>
  );
};
