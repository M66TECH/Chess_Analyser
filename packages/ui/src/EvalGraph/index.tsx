import React, { useRef, useEffect } from 'react';
import { MoveRecord, MoveClassification } from '@chess-analyzer/chess-core';

export interface EvalGraphProps {
  moves: MoveRecord[];
  currentMoveIndex: number;
  onMoveClick: (index: number) => void;
}

const CLASS_COLORS: Record<MoveClassification, string> = {
  brilliant: '#a855f7',
  great: '#38bdf8',
  best: '#22c55e',
  excellent: '#2dd4bf',
  good: '#94a3b8',
  inaccuracy: '#eab308',
  mistake: '#f97316',
  blunder: '#ef4444',
  book: '#94a3b8',
};

export const EvalGraph: React.FC<EvalGraphProps> = ({ moves, currentMoveIndex, onMoveClick }) => {
  const WIDTH = 400;
  const HEIGHT = 100;
  const PADDING = 8;

  if (moves.length === 0) {
    return (
      <div className="w-full h-24 flex items-center justify-center bg-slate-900/50 rounded-lg border border-slate-700/50">
        <span className="text-xs text-slate-500 italic">Le graphe s'affichera après le premier coup</span>
      </div>
    );
  }

  // Build data points: start at 0.5, then after each move
  const dataPoints: number[] = [0.5, ...moves.map(m => m.winProbAfter)];
  const totalPoints = dataPoints.length;

  const xScale = (i: number) => PADDING + (i / (totalPoints - 1)) * (WIDTH - 2 * PADDING);
  const yScale = (v: number) => PADDING + (1 - v) * (HEIGHT - 2 * PADDING);

  // Build path
  const pathD = dataPoints.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(v)}`).join(' ');

  // Fill area above the midline (white advantage) and below (black advantage)
  const midY = yScale(0.5);
  const areaAbove = `M ${xScale(0)} ${midY} ` +
    dataPoints.map((v, i) => `L ${xScale(i)} ${yScale(v)}`).join(' ') +
    ` L ${xScale(totalPoints - 1)} ${midY} Z`;
  const areaBelow = `M ${xScale(0)} ${midY} ` +
    dataPoints.map((v, i) => `L ${xScale(i)} ${yScale(v)}`).join(' ') +
    ` L ${xScale(totalPoints - 1)} ${midY} Z`;

  return (
    <div className="w-full relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-24 rounded-lg overflow-hidden border border-slate-700/50"
        preserveAspectRatio="none"
      >
        {/* Background */}
        <rect width={WIDTH} height={HEIGHT} fill="#0f172a" />

        {/* Midline */}
        <line x1={PADDING} y1={midY} x2={WIDTH - PADDING} y2={midY} stroke="#334155" strokeWidth="0.5" strokeDasharray="2 2" />

        {/* White advantage fill */}
        <clipPath id="clipAbove">
          <rect x="0" y="0" width={WIDTH} height={midY} />
        </clipPath>
        <path d={areaAbove} fill="rgba(241,245,249,0.15)" clipPath="url(#clipAbove)" />

        {/* Black advantage fill */}
        <clipPath id="clipBelow">
          <rect x="0" y={midY} width={WIDTH} height={HEIGHT - midY} />
        </clipPath>
        <path d={areaBelow} fill="rgba(15,23,42,0.5)" clipPath="url(#clipBelow)" />

        {/* Main line */}
        <path d={pathD} fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* Move dots */}
        {moves.map((move, i) => {
          const x = xScale(i + 1);
          const y = yScale(move.winProbAfter);
          const color = CLASS_COLORS[move.classification] ?? '#94a3b8';
          const isActive = i === currentMoveIndex;
          return (
            <g key={i} onClick={() => onMoveClick(i)} style={{ cursor: 'pointer' }}>
              <circle cx={x} cy={y} r={isActive ? 5 : (move.classification !== 'good' && move.classification !== 'book' ? 3.5 : 2)} fill={color} opacity={isActive ? 1 : 0.85} />
              {isActive && <circle cx={x} cy={y} r="7" fill="none" stroke={color} strokeWidth="1.5" opacity="0.5" />}
            </g>
          );
        })}
      </svg>

      {/* Labels */}
      <div className="absolute top-1 left-2 text-[9px] text-white/50 font-mono">Blanc +</div>
      <div className="absolute bottom-1 left-2 text-[9px] text-white/50 font-mono">Noir +</div>
    </div>
  );
};
