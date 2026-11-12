'use client';

import React, { useSyncExternalStore } from 'react';
import {
  ChessBoard,
  EvalBar,
  EvalGraph,
  KeyMoments,
  RetryBlunderBanner,
  DemoBanner,
  SoundService,
} from '@chess-analyzer/ui';
import type { MoveRecord, DemoStep } from '@chess-analyzer/chess-core';
import { hoverStore } from '../stores/hoverStore';

function ActiveChessBoard({
  fen,
  onMove,
  baseShapes,
  lastMove,
  orientation,
  interactive,
}: {
  fen: string;
  onMove?: (from: string, to: string) => void;
  baseShapes: Array<{ orig: string; dest?: string; brush: string }>;
  lastMove?: [string, string];
  orientation: 'white' | 'black';
  interactive: boolean;
}) {
  const hoveredShapes = useSyncExternalStore(
    hoverStore.subscribe,
    hoverStore.getShapes,
    () => null
  );
  const shapes = hoveredShapes && hoveredShapes.length > 0 ? hoveredShapes : baseShapes;
  return (
    <ChessBoard
      fen={fen}
      onMove={onMove}
      shapes={shapes}
      lastMove={lastMove}
      orientation={orientation}
      interactive={interactive}
    />
  );
}

export interface BoardAreaProps {
  fen: string;
  onMove?: (from: string, to: string) => void;
  shapes: Array<{ orig: string; dest?: string; brush: string }>;
  lastMove?: [string, string];
  orientation: 'white' | 'black';
  interactive: boolean;
  evalState: {
    winProb: number;
    cp?: number;
    mate?: number;
    status: 'idle' | 'analyzing' | 'ready' | 'error';
  };
  retryState: {
    blunderRecord: MoveRecord;
    status: 'idle' | 'success' | 'failed';
    isExactBest?: boolean;
    message?: string;
    revealed: boolean;
  } | null;
  onRevealRetry: () => void;
  onResetRetry: () => void;
  onCloseRetry: () => void;
  demo: {
    title: string;
    steps: DemoStep[];
    mode: 'idea' | 'punish';
    hasBothModes: boolean;
    record: MoveRecord;
  } | null;
  demoIndex: number;
  isDemoPlaying: boolean;
  onSwitchDemoMode: (mode: 'idea' | 'punish') => void;
  onNextDemoStep: () => void;
  onPrevDemoStep: () => void;
  onToggleDemoPlay: () => void;
  onResetDemo: () => void;
  onGoToDemoStep: (index: number) => void;
  onCloseDemo: () => void;
  records: MoveRecord[];
  activeIndex?: number;
  onPreviewIndex: (index: number | null) => void;
  onCommitIndex: (index: number) => void;
  onSelectNode: (nodeId: string) => void;
  onStartRetryBlunder: (record: MoveRecord) => void;
  onStartReview: () => void;
}

export function BoardArea({
  fen,
  onMove,
  shapes,
  lastMove,
  orientation,
  interactive,
  evalState,
  retryState,
  onRevealRetry,
  onResetRetry,
  onCloseRetry,
  demo,
  demoIndex,
  isDemoPlaying,
  onSwitchDemoMode,
  onNextDemoStep,
  onPrevDemoStep,
  onToggleDemoPlay,
  onResetDemo,
  onGoToDemoStep,
  onCloseDemo,
  records,
  activeIndex,
  onPreviewIndex,
  onCommitIndex,
  onSelectNode,
  onStartRetryBlunder,
  onStartReview,
}: BoardAreaProps) {
  return (
    <div className="flex flex-col gap-3 sm:gap-4 w-full xl:w-auto xl:shrink-0">
      {/* Mode Défi / Retry Blunder */}
      {retryState && (
        <div className="w-full max-w-[650px]">
          <RetryBlunderBanner
            blunderRecord={retryState.blunderRecord}
            status={retryState.status}
            isExactBest={retryState.isExactBest}
            message={retryState.message}
            revealed={retryState.revealed}
            onRevealSolution={onRevealRetry}
            onResetAttempt={onResetRetry}
            onClose={onCloseRetry}
          />
        </div>
      )}

      {/* Démonstration animée */}
      {demo && (
        <div className="w-full max-w-[650px]">
          <DemoBanner
            title={demo.title}
            steps={demo.steps}
            currentIndex={demoIndex}
            isPlaying={isDemoPlaying}
            mode={demo.mode}
            hasBothModes={demo.hasBothModes}
            onSwitchMode={onSwitchDemoMode}
            onNext={onNextDemoStep}
            onPrev={onPrevDemoStep}
            onTogglePlay={onToggleDemoPlay}
            onReset={onResetDemo}
            onGoTo={onGoToDemoStep}
            onClose={onCloseDemo}
          />
        </div>
      )}

      {/* Plateau + Barre d'évaluation */}
      <div className="flex gap-2 sm:gap-3">
        <EvalBar
          winProb={evalState.winProb}
          cp={evalState.cp}
          mate={evalState.mate}
          orientation={orientation}
        />
        <div className="relative flex-1 aspect-square max-w-[600px] shadow-2xl rounded-xl overflow-hidden border border-slate-800 ring-1 ring-white/10">
          <ActiveChessBoard
            fen={fen}
            onMove={onMove}
            baseShapes={shapes}
            lastMove={lastMove}
            orientation={orientation}
            interactive={interactive}
          />
        </div>
      </div>

      {/* Graphe d'évaluation + Moments Clés */}
      <div className="flex gap-3 w-full h-[120px] sm:h-[150px]">
        <div className="flex-1 glass-panel rounded-xl overflow-hidden p-2 sm:p-3 relative">
          <EvalGraph
            records={records}
            activeIndex={activeIndex}
            onPreviewIndex={onPreviewIndex}
            onCommitIndex={onCommitIndex}
            onNodeClick={(index) => {
              onPreviewIndex(null);
              const node = records[index];
              if (node) {
                onSelectNode(node.nodeId);
                SoundService.getInstance().play('move');
              }
            }}
          />
        </div>
        <div className="w-[160px] sm:w-[200px] shrink-0">
          <KeyMoments
            records={records}
            onNodeSelect={onSelectNode}
            onRetryBlunder={onStartRetryBlunder}
            onStartReview={onStartReview}
          />
        </div>
      </div>
    </div>
  );
}
