import React, { useMemo } from 'react';
import { MoveRecord } from '@chess-analyzer/chess-core';

interface EvalGraphProps {
  records: MoveRecord[];
  activeIndex?: number;
  onNodeClick?: (index: number) => void;
  width?: number;
  height?: number;
}

export const EvalGraph: React.FC<EvalGraphProps> = ({
  records,
  activeIndex,
  onNodeClick,
  width = 400,
  height = 150,
}) => {
  // Lichess formula returns chances between -1 (black) and 1 (white).
  // We want to map this to Y coordinates where y=0 is +1 (white winning), y=height is -1 (black winning), and y=height/2 is 0.

  const points = useMemo(() => {
    if (records.length === 0) return [];
    
    // Starting position is 0
    const startPoint = { x: 0, y: height / 2, index: -1 };
    
    const stepX = width / Math.max(20, records.length); // Minimum width for 20 moves to not stretch too much initially

    const mapped = records.map((record, i) => {
      // record.winProbAfter is [-1, 1]
      // Invert it because SVG y-axis grows downwards
      const normalizedY = (1 - record.winProbAfter) / 2; // [0, 1] where 0 is white win, 1 is black win
      const y = normalizedY * height;
      const x = (i + 1) * stepX;
      return { x, y, index: i, record };
    });

    return [startPoint, ...mapped];
  }, [records, width, height]);

  const pathD = useMemo(() => {
    if (points.length === 0) return '';
    return points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  }, [points]);

  // Create the filled area path for White and Black
  const fillWhitePath = useMemo(() => {
    if (points.length === 0) return '';
    const lastX = points[points.length - 1].x;
    return `${pathD} L ${lastX} ${height/2} L 0 ${height/2} Z`;
  }, [pathD, points, height]);

  const fillBlackPath = useMemo(() => {
    if (points.length === 0) return '';
    const lastX = points[points.length - 1].x;
    return `${pathD} L ${lastX} ${height/2} L 0 ${height/2} Z`; // The clip-path will handle the separation
  }, [pathD, points, height]);


  if (records.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
        Jouez des coups pour voir le graphe d'évaluation
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-gray-900 rounded-lg overflow-hidden select-none">
      <svg width={width} height={height} className="absolute top-0 left-0">
        <defs>
          <clipPath id="white-clip">
            <rect x="0" y="0" width={width} height={height / 2} />
          </clipPath>
          <clipPath id="black-clip">
            <rect x="0" y={height / 2} width={width} height={height / 2} />
          </clipPath>
          <linearGradient id="white-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.4" />
            <stop offset="100%" stopColor="white" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="black-grad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="black" stopOpacity="0.5" />
            <stop offset="100%" stopColor="black" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Center line (0.0 evaluation) */}
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#374151" strokeWidth={1} strokeDasharray="4 4" />

        {/* Fill White advantage */}
        <path d={fillWhitePath} fill="url(#white-grad)" clipPath="url(#white-clip)" />
        
        {/* Fill Black advantage */}
        <path d={fillBlackPath} fill="url(#black-grad)" clipPath="url(#black-clip)" />

        {/* Main line */}
        <path d={pathD} fill="none" stroke="#60A5FA" strokeWidth={2} strokeLinejoin="round" />

        {/* Data points */}
        {points.map((p, i) => {
          if (p.index === -1) return null; // Skip start point dot
          const isActive = activeIndex === p.index;
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={isActive ? 4 : 2}
              fill={isActive ? "#FFFFFF" : "#3B82F6"}
              stroke="#1E3A8A"
              strokeWidth={1}
              className="cursor-pointer hover:r-4 transition-all duration-150"
              onClick={() => onNodeClick && onNodeClick(p.index)}
            />
          );
        })}
      </svg>
    </div>
  );
};
