"use client";
import React from 'react';
import type { MoveRecord } from '@chess-analyzer/chess-core';
import type { InsightKind } from '@chess-analyzer/chess-core';

export interface CoachBubbleProps {
  record?: MoveRecord;
  /**
   * Ouvre la démonstration sur l'échiquier. Fournie par la page quand une
   * variante est disponible : on montre les coups plutôt que de les décrire.
   */
  onShowDemo?: (record: MoveRecord) => void;
  /** `true` si une suite de coups peut être montrée pour ce record. */
  canShowDemo?: boolean;
}

/** Icône + couleur par type d'explication (les 5 axes pédagogiques). */
const INSIGHT_STYLE: Record<InsightKind, { icon: string; label: string; color: string; ring: string }> = {
  played_move: { icon: '♟', label: 'Ce que fait votre coup', color: 'text-slate-300', ring: 'border-slate-600/60' },
  missed_move: { icon: '✦', label: 'Ce que vous pouviez jouer', color: 'text-amber-300', ring: 'border-amber-600/50' },
  mistake: { icon: '⚠', label: 'Pourquoi c\'est une erreur', color: 'text-orange-300', ring: 'border-orange-600/50' },
  good_decision: { icon: '✓', label: 'Pourquoi c\'était bien', color: 'text-emerald-300', ring: 'border-emerald-600/50' },
  consequence: { icon: '⇢', label: 'Conséquence', color: 'text-indigo-300', ring: 'border-indigo-600/50' },
};

const CLASSIFICATION_STYLE: Record<string, { badge: string; glow: string; label: string }> = {
  blunder: { badge: 'bg-red-500/20 border-red-500/50 text-red-200', glow: 'shadow-[0_0_15px_rgba(239,68,68,0.3)]', label: 'Gaffe' },
  mistake: { badge: 'bg-orange-500/20 border-orange-500/50 text-orange-200', glow: 'shadow-[0_0_15px_rgba(249,115,22,0.3)]', label: 'Erreur' },
  inaccuracy: { badge: 'bg-yellow-400/20 border-yellow-400/50 text-yellow-200', glow: 'shadow-[0_0_15px_rgba(250,204,21,0.3)]', label: 'Imprécision' },
  good: { badge: 'bg-green-500/20 border-green-500/50 text-green-200', glow: '', label: 'Bon coup' },
  excellent: { badge: 'bg-teal-400/20 border-teal-400/50 text-teal-200', glow: '', label: 'Excellent' },
  best: { badge: 'bg-emerald-500/25 border-emerald-500/50 text-emerald-200', glow: 'shadow-[0_0_18px_rgba(16,185,129,0.35)]', label: 'Meilleur coup' },
  great: { badge: 'bg-blue-500/25 border-blue-500/50 text-blue-200', glow: 'shadow-[0_0_18px_rgba(59,130,246,0.35)]', label: 'Superbe' },
  brilliant: { badge: 'bg-teal-500/25 border-teal-500/50 text-teal-100', glow: 'shadow-[0_0_20px_rgba(20,184,166,0.4)]', label: 'Brillant' },
  book: { badge: 'bg-purple-400/20 border-purple-400/50 text-purple-200', glow: '', label: 'Théorie' },
};

export const CoachBubble: React.FC<CoachBubbleProps> = ({ record, onShowDemo, canShowDemo = false }) => {
  if (!record) {
    return (
      <div className="glass-panel rounded-xl p-6 w-full h-full min-h-[280px] flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(99,102,241,0.3)]">
          <span className="text-3xl">&#129302;</span>
        </div>
        <h2 className="text-xl font-bold text-slate-200 mb-2">Votre coach est prêt</h2>
        <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
          Jouez un coup ou importez une partie : je vous explique chaque décision en langage simple,
          en m&apos;appuyant sur l&apos;analyse de Lichess.
        </p>
      </div>
    );
  }

  const card = record.coachCard;
  const style = CLASSIFICATION_STYLE[record.classification] ?? CLASSIFICATION_STYLE.good;
  const theory = record.theory;

  return (
    <div className="glass-panel rounded-xl w-full h-full flex flex-col overflow-hidden">
      {/* Header : coup + verdict */}
      <div className="bg-slate-900/80 px-4 py-3 border-b border-slate-700/50 flex justify-between items-start gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 bg-indigo-500/20 rounded-full flex items-center justify-center border border-indigo-500/30 shrink-0">
            <span className="text-lg">&#129302;</span>
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-slate-100 leading-tight text-sm">Coach IA</h3>
            <span className="text-[11px] text-slate-400 truncate block">
              {record.color === 'white' ? 'Blancs' : 'Noirs'} · coup {Math.floor(record.moveNumber)} ·{' '}
              <span className="font-mono text-slate-300">{record.san}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase tracking-wide ${style.badge} ${style.glow}`}>
            {style.label}
          </span>
          {typeof record.accuracy === 'number' && (
            <span className="text-[10px] text-slate-500 font-mono">{Math.round(record.accuracy)}% précision</span>
          )}
        </div>
      </div>

      {/* Bandeau théorie Lichess */}
      {theory && (
        <div className="px-4 py-1.5 border-b border-slate-700/50 bg-slate-900/40 flex items-center gap-1.5 flex-wrap text-[10px]">
          {theory.openingName && (
            <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-200 border border-purple-500/30">
              {theory.eco ? `${theory.eco} · ` : ''}{theory.openingName}
            </span>
          )}
          {theory.isTheory ? (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-200 border border-emerald-500/30">
              Théorie{theory.frequency !== undefined ? ` · ${Math.round(theory.frequency * 100)} %` : ''}
            </span>
          ) : theory.inBook ? (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-500/30">
              Hors ligne principale
            </span>
          ) : null}
          {theory.games ? (
            <span className="text-slate-500">{theory.games.toLocaleString('fr-FR')} parties</span>
          ) : null}
        </div>
      )}

      {/* Corps */}
      <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
        {card ? (
          <div className="space-y-3">
            {card.headline && (
              <p className="text-sm font-semibold text-slate-100 leading-snug">{card.headline}</p>
            )}

            <div className="space-y-2">
              {card.insights.map((insight, i) => {
                const st = INSIGHT_STYLE[insight.kind];
                return (
                  <div key={`${insight.kind}-${i}`} className={`border-l-2 ${st.ring} pl-2.5`}>
                    <div className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${st.color}`}>
                      {st.icon} {st.label}
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{insight.text}</p>
                  </div>
                );
              })}
            </div>

            {card.takeaway && (
              <div className="mt-3 pt-3 border-t border-slate-700/50">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-300 mb-1">
                  &#128161; À retenir
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{card.takeaway}</p>
              </div>
            )}

            {/*
              Plutôt qu'un long texte, on montre la suite sur l'échiquier :
              la démonstration joue les deux camps coup par coup.
            */}
            {canShowDemo && onShowDemo && (
              <button
                onClick={() => onShowDemo(record)}
                className="mt-1 w-full px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/30 transition-colors flex items-center justify-center gap-2"
              >
                <span aria-hidden="true">&#9654;</span>
                Montrer sur l’échiquier
              </button>
            )}
          </div>
        ) : (
          <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-slate-500 gap-3">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            <span className="text-xs" role="status" aria-live="polite">
              Le coach lit l&apos;analyse de Lichess…
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
