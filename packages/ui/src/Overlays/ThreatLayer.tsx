import React from 'react';
import { TacticalMotif } from '@chess-analyzer/chess-core';

export interface ThreatLayerProps {
  motifs: TacticalMotif[];
  orientation?: 'white' | 'black';
}

function squareToCoords(sq: string, orientation: 'white' | 'black') {
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1], 10) - 1;
  const x = orientation === 'white' ? file : 7 - file;
  const y = orientation === 'white' ? 7 - rank : rank;
  return { cx: x * 12.5 + 6.25, cy: y * 12.5 + 6.25 };
}

const MOTIF_COLORS: Record<TacticalMotif['type'], string> = {
  hanging_piece: 'rgba(239, 68, 68, 0.85)',    // red
  fork: 'rgba(234, 179, 8, 0.85)',              // yellow
  pin: 'rgba(168, 85, 247, 0.85)',              // purple
  skewer: 'rgba(249, 115, 22, 0.85)',           // orange
  discovered_attack: 'rgba(59, 130, 246, 0.85)' // blue
};

export const ThreatLayer: React.FC<ThreatLayerProps> = ({ motifs, orientation = 'white' }) => {
  return (
    <>
      {motifs.flatMap((motif, i) =>
        motif.squares.slice(0, 1).map((sq) => {
          const { cx, cy } = squareToCoords(sq, orientation);
          const color = MOTIF_COLORS[motif.type] ?? 'rgba(239,68,68,0.8)';
          return (
            <g key={`${motif.type}-${i}-${sq}`}>
              {/* Pulsing outer ring */}
              <circle
                cx={`${cx}%`}
                cy={`${cy}%`}
                r="5.8%"
                fill="none"
                stroke={color}
                strokeWidth="1.5%"
                opacity="0.6"
                className="animate-ping"
              />
              {/* Solid inner ring */}
              <circle
                cx={`${cx}%`}
                cy={`${cy}%`}
                r="5%"
                fill="none"
                stroke={color}
                strokeWidth="1%"
              />
            </g>
          );
        })
      )}
    </>
  );
};
