'use client';

import { useEffect } from 'react';

export interface KeyboardShortcutHandlers {
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
  onFlipBoard: () => void;
  onCloseModals: () => void;
  onToggleHelp: () => void;
}

export function useKeyboardShortcuts(
  handlers: KeyboardShortcutHandlers,
  enabled: boolean = true
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Ignore keyboard shortcuts when typing in inputs/textareas
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          handlers.onPrev();
          break;
        case 'ArrowRight':
          event.preventDefault();
          handlers.onNext();
          break;
        case 'ArrowUp':
          event.preventDefault();
          handlers.onFirst();
          break;
        case 'ArrowDown':
          event.preventDefault();
          handlers.onLast();
          break;
        case 'f':
        case 'F':
          event.preventDefault();
          handlers.onFlipBoard();
          break;
        case 'Escape':
          event.preventDefault();
          handlers.onCloseModals();
          break;
        case '?':
          event.preventDefault();
          handlers.onToggleHelp();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, enabled]);
}
