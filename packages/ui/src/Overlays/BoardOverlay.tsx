import React from 'react';

export interface BoardOverlayProps {
  children: React.ReactNode;
}

export const BoardOverlay: React.FC<BoardOverlayProps> = ({ children }) => {
  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
      preserveAspectRatio="none"
    >
      {children}
    </svg>
  );
};
