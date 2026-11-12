'use client';

import React from 'react';
import { MoveTree, MoveList, Explorer } from '@chess-analyzer/ui';
import type { MoveNode, MoveRecord } from '@chess-analyzer/chess-core';
import type { MobilePanelTab } from './MobileNavigationTabs';

export interface AnalysisRailProps {
  mobilePanel: MobilePanelTab;
  treeNodes: Map<string, MoveNode>;
  records: MoveRecord[];
  activeNodeId: string | null;
  activeIndex?: number;
  explorerData: any;
  onSelectNode: (nodeId: string) => void;
  onExplorerMove: (move: { san: string; uci: string }) => void;
}

export function AnalysisRail({
  mobilePanel,
  treeNodes,
  records,
  activeNodeId,
  activeIndex,
  explorerData,
  onSelectNode,
  onExplorerMove,
}: AnalysisRailProps) {
  const isTreeEnabled = process.env.NEXT_PUBLIC_MOVE_TREE_ENABLED === 'true';

  return (
    <div
      className={`${
        mobilePanel === 'moves' || mobilePanel === 'explorer' ? 'flex' : 'hidden'
      } xl:flex flex-col gap-4 w-full xl:w-[300px] xl:shrink-0`}
    >
      <div className={`${mobilePanel === 'moves' ? 'block' : 'hidden'} xl:block h-[380px] xl:h-[460px]`}>
        {isTreeEnabled ? (
          <MoveTree
            nodes={treeNodes}
            records={records}
            activeNodeId={activeNodeId}
            onSelectNode={onSelectNode}
          />
        ) : (
          <MoveList
            records={records}
            activeIndex={activeIndex}
            onNodeClick={(index) => {
              const node = records[index];
              if (node) onSelectNode(node.nodeId);
            }}
          />
        )}
      </div>

      <div
        className={`${
          mobilePanel === 'explorer' ? 'block' : 'hidden'
        } xl:block h-[280px] glass-panel-light rounded-xl overflow-hidden relative`}
      >
        <Explorer data={explorerData} onMoveSelect={onExplorerMove} />
      </div>
    </div>
  );
}
