import React from 'react';
import { HeatmapData } from '@chess-analyzer/chess-core';

export interface HeatmapLayerProps {
  data: HeatmapData;
  orientation?: 'white' | 'black';
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

export const HeatmapLayer: React.FC<HeatmapLayerProps> = ({ data, orientation = 'white' }) => {
  return (
    <>
      {FILES.flatMap((file, fileIdx) =>
        RANKS.map((rank, rankIdx) => {
          const square = `${file}${rank}`;
          const influence = data[square];
          if (!influence) return null;

          const isWhiteOriented = orientation === 'white';
          const xIdx = isWhiteOriented ? fileIdx : 7 - fileIdx;
          const yIdx = isWhiteOriented ? 7 - rankIdx : rankIdx;

          const x = xIdx * 12.5;
          const y = yIdx * 12.5;

          const w = influence.whiteInfluence;
          const b = influence.blackInfluence;
          const diff = w - b;

          if (Math.abs(diff) < 0.5) return null; // skip near-zero differences

          const color = diff > 0 ? '#3b82f6' : '#ef4444';
          const opacity = Math.min(0.55, Math.abs(diff) * 0.12);

          return (
            <rect
              key={square}
              x={x}
              y={y}
              width="12.5"
              height="12.5"
              fill={color}
              fillOpacity={opacity}
              style={{ transition: 'fill-opacity 0.4s ease-in-out, fill 0.4s ease-in-out' }}
            />
          );
        })
      )}
    </>
  );
};
