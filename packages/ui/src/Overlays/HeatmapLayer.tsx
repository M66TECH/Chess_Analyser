import React from 'react';

export type HeatmapData = {
  [square: string]: {
    whiteInfluence: number;
    blackInfluence: number;
  };
};

export interface HeatmapLayerProps {
  data: HeatmapData;
  orientation?: 'white' | 'black';
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

export const HeatmapLayer: React.FC<HeatmapLayerProps> = ({ data, orientation = 'white' }) => {
  return (
    <>
      {FILES.map((file, fileIdx) => {
        return RANKS.map((rank, rankIdx) => {
          const square = `${file}${rank}`;
          const influence = data[square];
          if (!influence) return null;

          // Determine coordinates (0-100 scale)
          // For white orientation: a1 is bottom-left (x=0, y=87.5), a8 is top-left (x=0, y=0)
          const isWhiteOriented = orientation === 'white';
          
          const xIdx = isWhiteOriented ? fileIdx : 7 - fileIdx;
          const yIdx = isWhiteOriented ? 7 - rankIdx : rankIdx;

          const x = xIdx * 12.5;
          const y = yIdx * 12.5;

          // Calculate color and opacity based on influence
          // e.g., if whiteInfluence > blackInfluence -> blueish
          // if blackInfluence > whiteInfluence -> reddish
          const w = influence.whiteInfluence;
          const b = influence.blackInfluence;
          const diff = w - b;

          if (diff === 0) return null;

          const color = diff > 0 ? '#3b82f6' : '#ef4444'; // blue for white, red for black
          const opacity = Math.min(0.6, Math.abs(diff) * 0.15); // max 0.6 opacity

          return (
            <rect
              key={square}
              x={x}
              y={y}
              width="12.5"
              height="12.5"
              fill={color}
              fillOpacity={opacity}
              style={{ transition: 'fill-opacity 0.3s ease-in-out' }}
            />
          );
        });
      })}
    </>
  );
};
