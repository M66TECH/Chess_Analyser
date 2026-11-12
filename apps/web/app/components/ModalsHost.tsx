'use client';

import React, { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { MoveRecord, GameStats } from '@chess-analyzer/chess-core';
import { PromotionDialog } from '@chess-analyzer/ui';

const modalFallback = () => null;
const GameReport = dynamic(() => import('@chess-analyzer/ui').then((m) => m.GameReport), {
  loading: modalFallback,
});
const GameReviewModal = dynamic(() => import('@chess-analyzer/ui').then((m) => m.GameReviewModal), {
  loading: modalFallback,
});
const PgnImportModal = dynamic(() => import('@chess-analyzer/ui').then((m) => m.PgnImportModal), {
  loading: modalFallback,
});
const HelpModal = dynamic(() => import('./HelpModal').then((m) => m.HelpModal), {
  loading: modalFallback,
});

export interface ModalsHostProps {
  showGameReview: boolean;
  showReport: boolean;
  showImport: boolean;
  showHelp: boolean;
  records: MoveRecord[];
  stats: GameStats;
  promotion: { from: string; to: string; callback: (piece: 'q' | 'r' | 'b' | 'n') => void } | null;
  fen: string;
  onSelectNode: (nodeId: string) => void;
  onStartRetry: (record: MoveRecord) => void;
  onCloseGameReview: () => void;
  onCloseReport: () => void;
  onCloseImport: () => void;
  onCloseHelp: () => void;
  onImportPgn: (pgn: string) => void;
  onCancelPromotion: () => void;
}

/**
 * Conteneur accessible avec piège de focus et gestion ARIA (O13)
 */
function ModalOverlay({
  children,
  onClose,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClose: () => void;
  ariaLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousActiveElement.current = document.activeElement as HTMLElement | null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab' && containerRef.current) {
        const focusableElements = containerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // Mettre le focus sur le premier élément focusable
    const timer = setTimeout(() => {
      if (containerRef.current) {
        const first = containerRef.current.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        first?.focus();
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement.current?.focus?.();
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      ref={containerRef}
      className="fixed inset-0 z-[150] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4"
    >
      {children}
    </div>
  );
}

export function ModalsHost({
  showGameReview,
  showReport,
  showImport,
  showHelp,
  records,
  stats,
  promotion,
  fen,
  onSelectNode,
  onStartRetry,
  onCloseGameReview,
  onCloseReport,
  onCloseImport,
  onCloseHelp,
  onImportPgn,
  onCancelPromotion,
}: ModalsHostProps) {
  return (
    <>
      {showGameReview && (
        <ModalOverlay onClose={onCloseGameReview} ariaLabel="Revue guidée de la partie">
          <GameReviewModal
            records={records}
            onSelectNode={onSelectNode}
            onStartRetry={onStartRetry}
            onClose={onCloseGameReview}
          />
        </ModalOverlay>
      )}

      {showReport && (
        <ModalOverlay onClose={onCloseReport} ariaLabel="Bilan de précision de la partie">
          <GameReport stats={stats} onClose={onCloseReport} />
        </ModalOverlay>
      )}

      {showImport && (
        <ModalOverlay onClose={onCloseImport} ariaLabel="Importer une partie PGN">
          <PgnImportModal onImport={onImportPgn} onClose={onCloseImport} />
        </ModalOverlay>
      )}

      {showHelp && (
        <ModalOverlay onClose={onCloseHelp} ariaLabel="Aide et raccourcis clavier">
          <HelpModal onClose={onCloseHelp} />
        </ModalOverlay>
      )}

      {promotion && (
        <PromotionDialog
          from={promotion.from}
          to={promotion.to}
          color={fen.split(' ')[1] === 'w' ? 'white' : 'black'}
          onSelect={promotion.callback}
          onCancel={onCancelPromotion}
        />
      )}
    </>
  );
}
