/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EvalBar } from '../EvalBar';
import { EvalGraph } from '../EvalGraph';
import { MoveList } from '../MoveList';
import { MoveTree } from '../MoveTree';
import { CoachBubble } from '../CoachBubble';
import { BoardDemo } from '../BoardDemo';
import { GameReviewModal } from '../GameReview';
import { GameReport } from '../GameReport';
import type { MoveRecord, MoveNode, DemoStep, GameStats } from '@chess-analyzer/chess-core';

// Mock ChessBoard to avoid canvas / chessground DOM requirements in jsdom
vi.mock('../ChessBoard', () => ({
  ChessBoard: ({ fen, orientation, shapes }: { fen: string; orientation?: string; shapes?: Array<{ orig: string; dest?: string; brush: string }> }) => (
    <div data-testid="mock-chessboard" data-fen={fen} data-orientation={orientation} data-shapes-count={shapes?.length ?? 0}>
      Mock ChessBoard ({orientation})
    </div>
  ),
}));

const sampleRecords: MoveRecord[] = [
  {
    nodeId: 'n1',
    san: 'e4',
    uci: 'e2e4',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    color: 'white',
    moveNumber: 1,
    cpBefore: 20,
    cpAfter: 25,
    winProbBefore: 0.1,
    winProbAfter: 0.12,
    classification: 'best',
  },
  {
    nodeId: 'n2',
    san: 'e5',
    uci: 'e7e5',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    fenAfter: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    color: 'black',
    moveNumber: 1,
    cpBefore: 25,
    cpAfter: 15,
    winProbBefore: 0.12,
    winProbAfter: 0.08,
    classification: 'good',
  },
  {
    nodeId: 'n3',
    san: 'Qh5',
    uci: 'd1h5',
    fenBefore: '...',
    fenAfter: '...',
    color: 'white',
    moveNumber: 2,
    cpBefore: 15,
    cpAfter: -200,
    winProbBefore: 0.08,
    winProbAfter: -0.6,
    classification: 'blunder',
    bestMove: 'g1f3',
  },
];

describe('UI Components — Indispensable Suite', () => {
  describe('EvalBar', () => {
    it('affiche correctement le score centipions et les mats', () => {
      const { rerender } = render(<EvalBar winProb={0.6} cp={250} orientation="white" />);
      expect(screen.getByText('+2.5')).toBeInTheDocument();

      rerender(<EvalBar winProb={1} mate={3} orientation="white" />);
      expect(screen.getByText('M3')).toBeInTheDocument();

      rerender(<EvalBar winProb={-0.6} cp={-250} orientation="black" />);
      expect(screen.getByText('-2.5')).toBeInTheDocument();
    });
  });

  describe('EvalGraph', () => {
    it('affiche le message d\'attente si aucun coup puis trace les points', () => {
      const { rerender } = render(<EvalGraph records={[]} />);
      expect(screen.getByText(/Jouez des coups pour voir le graphe/i)).toBeInTheDocument();

      rerender(<EvalGraph records={sampleRecords} activeIndex={1} />);
      const svg = document.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('MoveList', () => {
    it('groupe les coups par numéro et gère le clic', () => {
      const onNodeClick = vi.fn();
      render(<MoveList records={sampleRecords} activeIndex={0} onNodeClick={onNodeClick} />);

      expect(screen.getByText('3 coups')).toBeInTheDocument();
      expect(screen.getByText('e4')).toBeInTheDocument();
      expect(screen.getByText('e5')).toBeInTheDocument();

      fireEvent.click(screen.getByText('e5'));
      expect(onNodeClick).toHaveBeenCalledWith(1);
    });
  });

  describe('MoveTree', () => {
    it('affiche les coups sous forme d\'arbre navigable', () => {
      const nodes = new Map<string, MoveNode>();
      nodes.set('n1', {
        id: 'n1',
        san: 'e4',
        uci: 'e2e4',
        fenBefore: '...',
        fenAfter: '...',
        moveNumber: 1,
        color: 'white',
        parentId: null,
        childrenIds: ['n2'],
        isMainline: true,
      });
      nodes.set('n2', {
        id: 'n2',
        san: 'e5',
        uci: 'e7e5',
        fenBefore: '...',
        fenAfter: '...',
        moveNumber: 1,
        color: 'black',
        parentId: 'n1',
        childrenIds: [],
        isMainline: true,
      });

      const onSelect = vi.fn();
      render(<MoveTree nodes={nodes} records={sampleRecords} activeNodeId="n1" onSelectNode={onSelect} />);

      expect(screen.getByRole('tree')).toBeInTheDocument();
      expect(screen.getByText('e4')).toBeInTheDocument();

      fireEvent.click(screen.getByText('e5'));
      expect(onSelect).toHaveBeenCalledWith('n2');
    });
  });

  describe('CoachBubble', () => {
    it('affiche la bulle coach avec conseils et déclenchement de la démo', () => {
      const onShowDemo = vi.fn();
      const recordWithCoach: MoveRecord = {
        ...sampleRecords[0],
        coachCard: {
          headline: 'Développement du pion roi',
          insights: [{ kind: 'played_move', text: 'Prend le centre.' }],
          takeaway: 'Contrôler le centre.',
        },
      };

      render(<CoachBubble record={recordWithCoach} canShowDemo={true} onShowDemo={onShowDemo} />);
      expect(screen.getByText('Développement du pion roi')).toBeInTheDocument();
      expect(screen.getByText('Prend le centre.')).toBeInTheDocument();

      const demoBtn = screen.getByRole('button', { name: /Montrer sur l’échiquier/i });
      fireEvent.click(demoBtn);
      expect(onShowDemo).toHaveBeenCalledWith(recordWithCoach);
    });
  });

  describe('BoardDemo', () => {
    it('navigue dans les étapes de la démonstration sans changer d\'orientation', () => {
      const steps: DemoStep[] = [
        {
          fen: 'fen_1',
          uci: 'e2e4',
          san: 'e4',
          caption: 'Avance en e4.',
          from: 'e2',
          to: 'e4',
          highlight: ['e2', 'e4'],
          check: false,
          checkmate: false,
        },
      ];

      const onClose = vi.fn();
      render(
        <BoardDemo
          title="Ce qu'il fallait jouer"
          startFen="start_fen"
          steps={steps}
          orientation="white"
          onClose={onClose}
        />
      );

      expect(screen.getByText("Ce qu'il fallait jouer")).toBeInTheDocument();
      const board = screen.getByTestId('mock-chessboard');
      expect(board).toHaveAttribute('data-orientation', 'white');

      fireEvent.click(screen.getByRole('button', { name: /Suivant/i }));
      expect(screen.getByText('Avance en e4.')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Quitter la démonstration/i }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('GameReviewModal', () => {
    it('affiche les statistiques de revue et les moments clés', () => {
      const onSelect = vi.fn();
      render(<GameReviewModal records={sampleRecords} onSelectNode={onSelect} onStartRetry={vi.fn()} onClose={vi.fn()} />);

      expect(screen.getByText('Revue guidée de partie')).toBeInTheDocument();
      expect(screen.getByText('Retenter ce coup')).toBeInTheDocument();
    });
  });

  describe('GameReport (P3.16)', () => {
    it('affiche le bilan complet avec phases, décompte des coups et tournant décisif', () => {
      const mockStats: GameStats = {
        accuracy: { white: 91.5, black: 84.2 },
        acpl: { white: 18, black: 42 },
        inaccuracies: { white: 1, black: 3 },
        mistakes: { white: 0, black: 2 },
        blunders: { white: 0, black: 1 },
        classificationCounts: {
          white: { brilliant: 1, great: 1, best: 8, excellent: 4, good: 2, inaccuracy: 1, mistake: 0, blunder: 0, book: 2 },
          black: { brilliant: 0, great: 0, best: 6, excellent: 2, good: 4, inaccuracy: 3, mistake: 2, blunder: 1, book: 2 },
        },
        phaseStats: {
          opening: { white: 95, black: 92 },
          middlegame: { white: 90, black: 78 },
          endgame: { white: 88, black: 80 },
        },
        criticalMoment: {
          moveNumber: 24,
          color: 'black',
          san: 'f6??',
          playedMove: 'f7f6',
          bestMove: 'e8e7',
          fenBefore: 'r3r1k1/pp3ppp/2p5/8/8/8/PPPP1PPP/R3R1K1 b - - 0 1',
          winDrop: 0.45,
          cpBefore: -50,
          cpAfter: 480,
          description: 'Tournant du match au coup 24 : f6?? (Noirs) a coûté 45% de chances.',
        },
        takeaway: 'Excellente partie des Blancs avec un coup brillant décisif.',
      };

      render(<GameReport stats={mockStats} onClose={vi.fn()} />);

      expect(screen.getByText('Bilan complet du match')).toBeInTheDocument();
      expect(screen.getByText('91.5%')).toBeInTheDocument();
      expect(screen.getByText('84.2%')).toBeInTheDocument();
      expect(screen.getByText('Tournant décisif du match')).toBeInTheDocument();
      expect(screen.getByText(/Tournant du match au coup 24/)).toBeInTheDocument();
      expect(screen.getByText('Précision par Phase')).toBeInTheDocument();
      expect(screen.getByText('Coups Brillants')).toBeInTheDocument();
    });
  });
});
