import React, { useMemo, useState, useRef, useCallback } from 'react';
import { MoveRecord, formatEval } from '@chess-analyzer/chess-core';

export interface EvalGraphProps {
  records: MoveRecord[];
  activeIndex?: number;
  onNodeClick?: (index: number) => void;
  /** Deuxième vitesse : prévisualisation purement locale pendant le scrub (sans appel moteur). */
  onPreviewIndex?: (index: number | null) => void;
  /** Deuxième vitesse : engagement officiel au relâchement de la souris ou clic. */
  onCommitIndex?: (index: number) => void;
  width?: number;
  height?: number;
}

const CLASSIFICATION_DOT: Record<string, { fill: string; stroke: string; r: number; glow?: string }> = {
  blunder: { fill: '#EF4444', stroke: '#991B1B', r: 4.5, glow: 'drop-shadow(0 0 4px rgba(239,68,68,0.8))' },
  mistake: { fill: '#F97316', stroke: '#9A3412', r: 4, glow: 'drop-shadow(0 0 3px rgba(249,115,22,0.7))' },
  inaccuracy: { fill: '#FACC15', stroke: '#854D0E', r: 3.5 },
  brilliant: { fill: '#14B8A6', stroke: '#0F766E', r: 4.5, glow: 'drop-shadow(0 0 5px rgba(20,184,166,0.9))' },
  great: { fill: '#3B82F6', stroke: '#1D4ED8', r: 4, glow: 'drop-shadow(0 0 4px rgba(59,130,246,0.7))' },
  best: { fill: '#10B981', stroke: '#065F46', r: 3.5 },
  book: { fill: '#A855F7', stroke: '#6B21A8', r: 3 },
  good: { fill: '#3B82F6', stroke: '#1E3A8A', r: 2.5 },
};

const CLASSIFICATION_LABEL: Record<string, string> = {
  blunder: 'Gaffe ??',
  mistake: 'Erreur ?',
  inaccuracy: 'Imprécision ?!',
  brilliant: 'Brillant !!',
  great: 'Superbe !',
  best: 'Meilleur coup',
  book: 'Coup théorique',
  good: 'Bon coup',
};

export const EvalGraph: React.FC<EvalGraphProps> = ({
  records,
  activeIndex,
  onNodeClick,
  onPreviewIndex,
  onCommitIndex,
  width = 400,
  height = 150,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const isDragging = useRef(false);

  const points = useMemo(() => {
    if (records.length === 0) return [];

    const stepX = width / Math.max(20, records.length);
    const startPoint = { x: 0, y: height / 2, index: -1, record: undefined as unknown as MoveRecord };

    const mapped = records.map((record, i) => {
      // Invert because SVG y-axis grows downwards
      const normalizedY = (1 - (record.winProbAfter ?? 0)) / 2;
      const clampedY = Math.max(0, Math.min(1, normalizedY));
      const y = clampedY * height;
      const x = (i + 1) * stepX;
      return { x, y, index: i, record };
    });

    return [startPoint, ...mapped];
  }, [records, width, height]);

  const pathD = useMemo(() => {
    if (points.length === 0) return '';
    return points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  }, [points]);

  const fillWhitePath = useMemo(() => {
    if (points.length === 0) return '';
    const lastX = points[points.length - 1].x;
    return `${pathD} L ${lastX} ${height / 2} L 0 ${height / 2} Z`;
  }, [pathD, points, height]);

  const fillBlackPath = useMemo(() => {
    if (points.length === 0) return '';
    const lastX = points[points.length - 1].x;
    return `${pathD} L ${lastX} ${height / 2} L 0 ${height / 2} Z`;
  }, [pathD, points, height]);

  const activePoint = useMemo(
    () => (activeIndex === undefined ? undefined : points.find(p => p.index === activeIndex)),
    [points, activeIndex]
  );

  const displayedIndex = hoverIndex !== null ? hoverIndex : activeIndex;
  const hoveredPoint = useMemo(
    () => (displayedIndex === undefined || displayedIndex === null ? undefined : points.find(p => p.index === displayedIndex)),
    [points, displayedIndex]
  );

  const getIndexFromPointer = useCallback(
    (clientX: number): number | null => {
      if (!containerRef.current || records.length === 0) return null;
      const rect = containerRef.current.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const fraction = Math.max(0, Math.min(1, relativeX / rect.width));
      const targetIndex = Math.min(records.length - 1, Math.max(0, Math.round(fraction * records.length - 1)));
      return targetIndex;
    },
    [records.length]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    const idx = getIndexFromPointer(e.clientX);
    if (idx !== null) {
      setHoverIndex(idx);
      onPreviewIndex?.(idx);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const idx = getIndexFromPointer(e.clientX);
    if (idx !== null) {
      setHoverIndex(idx);
      onPreviewIndex?.(idx);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    const idx = getIndexFromPointer(e.clientX);
    if (idx !== null) {
      onCommitIndex?.(idx);
      onNodeClick?.(idx);
    }
  };

  const handlePointerLeave = () => {
    isDragging.current = false;
    setHoverIndex(null);
    onPreviewIndex?.(null);
  };

  if (records.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
        Jouez des coups pour voir le graphe d'évaluation
      </div>
    );
  }

  const hoverRecord = hoveredPoint?.record;
  const formattedScore = hoverRecord ? formatEval(hoverRecord.cpAfter, hoverRecord.mateAfter) : '0.0';
  const moveTitle = hoverRecord
    ? `${Math.floor(hoverRecord.moveNumber)}${hoverRecord.color === 'white' ? '.' : '...'} ${hoverRecord.san}`
    : '';
  const classLabel = hoverRecord?.classification ? (CLASSIFICATION_LABEL[hoverRecord.classification] ?? '') : '';

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-slate-900/90 rounded-lg overflow-hidden select-none cursor-crosshair touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="absolute inset-0"
      >
        <defs>
          <clipPath id="white-clip">
            <rect x="0" y="0" width={width} height={height / 2} />
          </clipPath>
          <clipPath id="black-clip">
            <rect x="0" y={height / 2} width={width} height={height / 2} />
          </clipPath>
          <linearGradient id="white-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="black-grad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#000000" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Center line (0.0 evaluation) */}
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#475569" strokeWidth={1} strokeDasharray="3 3" />

        {/* Advantage areas */}
        <path d={fillWhitePath} fill="url(#white-grad)" clipPath="url(#white-clip)" />
        <path d={fillBlackPath} fill="url(#black-grad)" clipPath="url(#black-clip)" />

        {/* Main curve */}
        <path d={pathD} fill="none" stroke="#60A5FA" strokeWidth={2} strokeLinejoin="round" />

        {/* Active move vertical marker */}
        {activePoint && (
          <line
            x1={activePoint.x}
            y1={0}
            x2={activePoint.x}
            y2={height}
            stroke="#818CF8"
            strokeWidth={1.5}
            strokeDasharray="2 2"
          />
        )}

        {/* Scrubber hover marker */}
        {hoveredPoint && (
          <line
            x1={hoveredPoint.x}
            y1={0}
            x2={hoveredPoint.x}
            y2={height}
            stroke="#F8FAFC"
            strokeWidth={1}
            opacity={0.8}
          />
        )}

        {/* Data points with key moments badges */}
        {points.map((p, i) => {
          if (p.index === -1 || !p.record) return null;
          const isActive = activeIndex === p.index;
          const isHovered = hoverIndex === p.index;
          const style = CLASSIFICATION_DOT[p.record.classification] ?? CLASSIFICATION_DOT.good;

          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={isHovered ? style.r + 2 : isActive ? style.r + 1.5 : style.r}
              fill={isHovered || isActive ? '#FFFFFF' : style.fill}
              stroke={style.stroke}
              strokeWidth={1.5}
              style={{ filter: style.glow }}
              className="cursor-pointer transition-all duration-100"
              onClick={(e) => {
                e.stopPropagation();
                onNodeClick?.(p.index);
                onCommitIndex?.(p.index);
              }}
            />
          );
        })}
      </svg>

      {/* Floating Tooltip displaying SAN, formatted score and classification */}
      {hoverRecord && hoveredPoint && (
        <div
          className="absolute top-2 z-30 pointer-events-none transform -translate-x-1/2 glass-panel-light px-2.5 py-1 rounded text-xs flex items-center gap-2 border border-slate-700 shadow-xl"
          style={{
            left: `${Math.max(60, Math.min(width - 60, (hoveredPoint.x / width) * 100))}%`,
          }}
        >
          <span className="font-bold text-slate-100 font-mono">{moveTitle}</span>
          <span className="text-indigo-300 font-mono font-semibold">{formattedScore}</span>
          {classLabel && <span className="text-[10px] text-slate-300 opacity-90">{classLabel}</span>}
        </div>
      )}
    </div>
  );
};
