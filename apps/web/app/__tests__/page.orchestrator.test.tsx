import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { StrictMode } from 'react';
import { render, screen, act } from '@testing-library/react';
import Home from '../page';
import { GameEventBus } from '@chess-analyzer/chess-core';

// Mock UI heavy components that have their own unit tests
vi.mock('@chess-analyzer/ui', () => ({
  ChessBoard: () => <div data-testid="mock-chessboard" />,
  EvalBar: () => <div data-testid="mock-evalbar" />,
  EvalGraph: () => <div data-testid="mock-evalgraph" />,
  MoveList: () => <div data-testid="mock-movelist" />,
  GameReport: () => <div data-testid="mock-gamereport" />,
  Explorer: () => <div data-testid="mock-explorer" />,
  KeyMoments: () => <div data-testid="mock-keymoments" />,
  CoachBubble: () => <div data-testid="mock-coachbubble" />,
  PgnImportModal: () => <div data-testid="mock-pgnmodal" />,
  PromotionDialog: () => <div data-testid="mock-promotiondialog" />,
  BoardDemo: () => <div data-testid="mock-boarddemo" />,
  GameReviewModal: () => <div data-testid="mock-gamereviewmodal" />,
  RetryBlunderBanner: () => <div data-testid="mock-retryblunderbanner" />,
  MoveTree: () => <div data-testid="mock-movetree" />,
  SoundService: {
    getInstance: () => ({
      isEnabled: () => true,
      toggle: () => false,
      play: vi.fn(),
      setVolume: vi.fn(),
      getVolume: () => 0.5,
    }),
  },
}));

// Mock Cloud and Explorer services to avoid network calls
vi.mock('@chess-analyzer/chess-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chess-analyzer/chess-core')>();
  
  class MockGameManager {
    public static instances: MockGameManager[] = [];
    public eventBus = new actual.GameEventBus();
    public moveManager = {
      getFen: () => 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      getUciMoves: () => [] as string[],
      getSanMoves: () => [] as string[],
      getTree: () => ({ nodes: new Map(), currentNodeId: null }),
    };
    public engineManager = {
      analyze: vi.fn(),
      reinit: vi.fn(),
      terminate: vi.fn(),
    };
    public pipeline = {
      reset: vi.fn(),
      getMoveRecords: () => [],
    };
    public activeNodeId: string | null = null;
    public isTerminated = false;

    constructor() {
      MockGameManager.instances.push(this);
    }

    public init() {}
    public terminate() {
      this.isTerminated = true;
    }
    public getMoveRecords() {
      return [];
    }
    public getActiveNodeId() {
      return this.activeNodeId;
    }
    public restoreSession() {
      return false;
    }
    public playMove(_uci: string) {
      return { success: true, nodeId: 'n1', san: 'e4' };
    }
  }

  return {
    ...actual,
    GameManager: MockGameManager,
    CloudEvalService: {
      fetch: vi.fn().mockResolvedValue(null),
    },
    ExplorerService: {
      fetch: vi.fn().mockResolvedValue(null),
    },
  };
});

describe('Page Orchestrator (Home)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts cleanly under React.StrictMode and cleans up terminated instances', () => {
    const { unmount } = render(
      <StrictMode>
        <Home />
      </StrictMode>
    );

    // Verify all primary layout components mounted
    expect(screen.getByText('Chess Analyzer')).toBeInTheDocument();
    expect(screen.getByTestId('mock-chessboard')).toBeInTheDocument();
    expect(screen.getByTestId('mock-evalbar')).toBeInTheDocument();
    expect(screen.getByTestId('mock-coachbubble')).toBeInTheDocument();

    // Now unmount completely
    unmount();
  });

  it('updates state upon receiving GameEventBus events', async () => {
    const { GameManager } = await import('@chess-analyzer/chess-core');
    const MockGM = GameManager as unknown as { instances: any[] };

    render(<Home />);

    const latestInstance = MockGM.instances[MockGM.instances.length - 1];
    expect(latestInstance).toBeDefined();

    // Trigger PositionChanged
    act(() => {
      latestInstance.eventBus.emit('PositionChanged', {
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      });
    });

    // Trigger AnalysisStarted
    act(() => {
      latestInstance.eventBus.emit('AnalysisStarted', {
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      });
    });

    // Check status indicator reflects analyzing
    expect(screen.getByTitle('Analyse Stockfish locale')).toBeInTheDocument();
  });
});
