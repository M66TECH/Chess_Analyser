"use client";
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { MoveRecord, InsightKind, BoardShape } from '@chess-analyzer/chess-core';
import { computeDeterministicHighlights } from '@chess-analyzer/chess-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRobot,
  faChessPawn,
  faBullseye,
  faTriangleExclamation,
  faCheck,
  faArrowRight,
  faLightbulb,
  faPlay,
  faVolumeHigh,
  faStop,
  faChevronDown,
  faChevronUp,
  faCompass,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import { SpeechService, type SpeechState } from '../sound/SpeechService';

export interface CoachBubbleProps {
  record?: MoveRecord;
  /**
   * Ouvre la démonstration sur l'échiquier. Fournie par la page quand une
   * variante est disponible : on montre les coups plutôt que de les décrire.
   */
  onShowDemo?: (record: MoveRecord) => void;
  /** `true` si une suite de coups peut être montrée pour ce record. */
  canShowDemo?: boolean;
  /**
   * Émet des surbrillances déterministes sur l'échiquier au survol d'une section.
   */
  onHoverInsight?: (shapes: BoardShape[] | null) => void;
  /** Déclenche à la demande l'approfondissement pédagogique (Niveau 2). */
  onDeepDive?: (record: MoveRecord) => Promise<unknown> | void;
  /** `true` pendant la génération complémentaire « Approfondir ». */
  isDeepDiveLoading?: boolean;
}

/** Icône + couleur par type d'explication (les 5 axes pédagogiques). */
const INSIGHT_STYLE: Record<InsightKind, { icon: IconDefinition; label: string; color: string; ring: string }> = {
  played_move: { icon: faChessPawn, label: 'Ce que fait votre coup', color: 'text-slate-300', ring: 'border-slate-600/60' },
  missed_move: { icon: faBullseye, label: 'Ce que vous pouviez jouer', color: 'text-amber-300', ring: 'border-amber-600/50' },
  mistake: { icon: faTriangleExclamation, label: 'Pourquoi c\'est une erreur', color: 'text-orange-300', ring: 'border-orange-600/50' },
  good_decision: { icon: faCheck, label: 'Pourquoi c\'était bien', color: 'text-emerald-300', ring: 'border-emerald-600/50' },
  consequence: { icon: faArrowRight, label: 'Conséquence', color: 'text-indigo-300', ring: 'border-indigo-600/50' },
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

export const CoachBubble: React.FC<CoachBubbleProps> = ({
  record,
  onShowDemo,
  canShowDemo = false,
  onHoverInsight,
  onDeepDive,
  isDeepDiveLoading = false,
}) => {
  const [speechState, setSpeechState] = useState<SpeechState>(() =>
    SpeechService.getInstance().getState()
  );
  // Mémorise l'état ouvert/replié de l'approfondissement par coup (`nodeId`)
  const [expandedDeepDiveByNode, setExpandedDeepDiveByNode] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const unsub = SpeechService.getInstance().subscribe(setSpeechState);
    return () => unsub();
  }, []);

  // Arrêt de la voix si l'utilisateur change de coup
  useEffect(() => {
    return () => {
      SpeechService.getInstance().stop();
    };
  }, [record?.nodeId]);

  const card = record?.coachCard;
  const deepDive = card?.deepDive;
  const isDeepDiveExpanded = Boolean(
    record && deepDive && (expandedDeepDiveByNode[record.nodeId] ?? true)
  );

  const handleDeepDiveClick = useCallback(() => {
    if (!record || isDeepDiveLoading) return;
    if (deepDive) {
      setExpandedDeepDiveByNode((prev) => ({
        ...prev,
        [record.nodeId]: !(prev[record.nodeId] ?? true),
      }));
      return;
    }
    setExpandedDeepDiveByNode((prev) => ({ ...prev, [record.nodeId]: true }));
    onDeepDive?.(record);
  }, [record, deepDive, isDeepDiveLoading, onDeepDive]);

  const fullSpeechText = useMemo(() => {
    if (!record || !card) return '';
    const parts: string[] = [];
    if (card.headline) parts.push(card.headline);
    if (card.idea || card.objective) {
      if (card.idea) parts.push(`L'idée : ${card.idea}`);
      if (card.objective) parts.push(`Votre objectif : ${card.objective}`);
    } else {
      for (const insight of card.insights) {
        const st = INSIGHT_STYLE[insight.kind];
        parts.push(`${st ? st.label : ''} : ${insight.text}`);
      }
    }
    if (card.takeaway) {
      parts.push(`À retenir : ${card.takeaway}`);
    }
    if (isDeepDiveExpanded && deepDive) {
      if (deepDive.summary) parts.push(deepDive.summary);
      for (const sec of deepDive.sections) {
        parts.push(`${sec.title} : ${sec.content}`);
      }
    }
    return parts.join(' ');
  }, [record, card, isDeepDiveExpanded, deepDive]);

  const isCurrentCardSpeaking =
    speechState.isSpeaking &&
    Boolean(fullSpeechText) &&
    speechState.currentText === fullSpeechText;

  const handleToggleSpeech = useCallback(() => {
    if (!fullSpeechText) return;
    SpeechService.getInstance().toggle(fullSpeechText);
  }, [fullSpeechText]);

  const handleSpeakSnippet = useCallback((e: React.MouseEvent, snippetText: string) => {
    e.stopPropagation();
    SpeechService.getInstance().toggle(snippetText);
  }, []);

  if (!record) {
    return (
      <div className="glass-panel rounded-xl p-6 w-full h-full min-h-[280px] flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(99,102,241,0.3)]">
          <FontAwesomeIcon icon={faRobot} className="text-3xl text-indigo-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-200 mb-2">Votre coach est prêt</h2>
        <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
          Jouez un coup ou importez une partie : je vous explique chaque décision en langage simple,
          en m&apos;appuyant sur l&apos;analyse de Lichess.
        </p>
      </div>
    );
  }

  const isBestDefense =
    record.classification === 'best' &&
    typeof record.mateBefore === 'number' &&
    record.mateBefore < 0;

  const style = isBestDefense
    ? {
        badge: 'bg-teal-500/25 border-teal-500/50 text-teal-200',
        glow: 'shadow-[0_0_18px_rgba(20,184,166,0.35)]',
        label: 'Meilleure défense',
      }
    : (CLASSIFICATION_STYLE[record.classification] ?? CLASSIFICATION_STYLE.good);
  const theory = record.theory;
  const isSpeechSupported = SpeechService.getInstance().isSupported();

  return (
    <div className="glass-panel rounded-xl w-full h-full flex flex-col overflow-hidden">
      {/* Header : coup + verdict + contrôle audio */}
      <div className="bg-slate-900/80 px-4 py-3 border-b border-slate-700/50 flex justify-between items-start gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 bg-indigo-500/20 rounded-full flex items-center justify-center border border-indigo-500/30 shrink-0">
            <span className="text-lg" aria-hidden="true">&#129302;</span>
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-slate-100 leading-tight text-sm">Coach IA</h3>
            <span className="text-[11px] text-slate-400 truncate block">
              {record.color === 'white' ? 'Blancs' : 'Noirs'} · coup {Math.floor(record.moveNumber)} ·{' '}
              <span className="font-mono text-slate-300">{record.san}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            {isSpeechSupported && card && (
              <button
                type="button"
                onClick={handleToggleSpeech}
                aria-label={isCurrentCardSpeaking ? "Arrêter la lecture vocale" : "Écouter l'analyse vocale"}
                title={isCurrentCardSpeaking ? "Arrêter la lecture audio" : "Écouter l'analyse à voix haute"}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-all ${
                  isCurrentCardSpeaking
                    ? 'bg-indigo-600 text-white shadow-[0_0_12px_rgba(99,102,241,0.6)] animate-pulse'
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60'
                }`}
              >
                <FontAwesomeIcon icon={isCurrentCardSpeaking ? faStop : faVolumeHigh} className="text-[10px]" />
                <span className="text-[10px] hidden sm:inline">
                  {isCurrentCardSpeaking ? 'Arrêter' : 'Écouter'}
                </span>
              </button>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase tracking-wide ${style.badge} ${style.glow}`}>
              {style.label}
            </span>
          </div>
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

            {/* Transparence mode dégradé */}
            {card.degraded && (
              <div className="flex items-center gap-1.5 text-[10px] text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-md px-2 py-1">
                <span aria-hidden="true">&#9432;</span>
                Explication locale de repli (moteur déterministe)
              </div>
            )}

            {/* Niveau 1 : 3 blocs structurés (L'idée, Votre objectif, À retenir) ou repli insights */}
            {card.idea || card.objective ? (
              <div className="space-y-2">
                {card.idea && (
                  <div
                    className={`border-l-2 ${
                      card.insights[0] ? INSIGHT_STYLE[card.insights[0].kind].ring : 'border-slate-600/60'
                    } pl-2.5 py-1 px-1.5 rounded-r transition-colors hover:bg-slate-800/50 cursor-pointer group`}
                    onMouseEnter={() => {
                      if (record && onHoverInsight) {
                        const kind = card.insights[0]?.kind ?? 'played_move';
                        onHoverInsight(computeDeterministicHighlights(kind, record));
                      }
                    }}
                    onMouseLeave={() => onHoverInsight?.(null)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-semibold uppercase tracking-wide mb-0.5 flex items-center gap-1.5 text-slate-200">
                        <FontAwesomeIcon
                          icon={card.insights[0] ? INSIGHT_STYLE[card.insights[0].kind].icon : faChessPawn}
                          className="w-3 h-3 shrink-0 text-indigo-300"
                        />
                        <span>L&apos;idée</span>
                      </div>
                      {isSpeechSupported && (
                        <button
                          type="button"
                          onClick={(e) => handleSpeakSnippet(e, `L'idée : ${card.idea}`)}
                          title="Écouter ce point"
                          aria-label="Écouter : L'idée"
                          className={`p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity ${
                            speechState.isSpeaking && speechState.currentText === `L'idée : ${card.idea}`
                              ? 'opacity-100 text-indigo-400'
                              : 'text-slate-400 hover:text-indigo-300'
                          }`}
                        >
                          <FontAwesomeIcon
                            icon={
                              speechState.isSpeaking && speechState.currentText === `L'idée : ${card.idea}`
                                ? faStop
                                : faVolumeHigh
                            }
                            className="text-[10px]"
                          />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{card.idea}</p>
                  </div>
                )}

                {card.objective && (
                  <div
                    className={`border-l-2 ${
                      card.insights[1] ? INSIGHT_STYLE[card.insights[1].kind].ring : 'border-emerald-600/50'
                    } pl-2.5 py-1 px-1.5 rounded-r transition-colors hover:bg-slate-800/50 cursor-pointer group`}
                    onMouseEnter={() => {
                      if (record && onHoverInsight) {
                        const kind = card.insights[1]?.kind ?? 'good_decision';
                        onHoverInsight(computeDeterministicHighlights(kind, record));
                      }
                    }}
                    onMouseLeave={() => onHoverInsight?.(null)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-semibold uppercase tracking-wide mb-0.5 flex items-center gap-1.5 text-emerald-300">
                        <FontAwesomeIcon icon={faBullseye} className="w-3 h-3 shrink-0" />
                        <span>Votre objectif</span>
                      </div>
                      {isSpeechSupported && (
                        <button
                          type="button"
                          onClick={(e) => handleSpeakSnippet(e, `Votre objectif : ${card.objective}`)}
                          title="Écouter ce point"
                          aria-label="Écouter : Votre objectif"
                          className={`p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity ${
                            speechState.isSpeaking && speechState.currentText === `Votre objectif : ${card.objective}`
                              ? 'opacity-100 text-indigo-400'
                              : 'text-slate-400 hover:text-indigo-300'
                          }`}
                        >
                          <FontAwesomeIcon
                            icon={
                              speechState.isSpeaking && speechState.currentText === `Votre objectif : ${card.objective}`
                                ? faStop
                                : faVolumeHigh
                            }
                            className="text-[10px]"
                          />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{card.objective}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {card.insights.map((insight, i) => {
                  const st = INSIGHT_STYLE[insight.kind];
                  const snippetText = `${st ? st.label : ''} : ${insight.text}`;
                  const isSnippetSpeaking =
                    speechState.isSpeaking && speechState.currentText === snippetText;

                  return (
                    <div
                      key={`${insight.kind}-${i}`}
                      className={`border-l-2 ${st.ring} pl-2.5 py-1 px-1.5 rounded-r transition-colors hover:bg-slate-800/50 cursor-pointer group`}
                      onMouseEnter={() => {
                        if (record && onHoverInsight) {
                          const shapes = computeDeterministicHighlights(insight.kind, record);
                          onHoverInsight(shapes);
                        }
                      }}
                      onMouseLeave={() => {
                        onHoverInsight?.(null);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 flex items-center gap-1.5 ${st.color}`}>
                          <FontAwesomeIcon icon={st.icon} className="w-3 h-3 shrink-0" />
                          <span>{st.label}</span>
                        </div>
                        {isSpeechSupported && (
                          <button
                            type="button"
                            onClick={(e) => handleSpeakSnippet(e, snippetText)}
                            title={isSnippetSpeaking ? "Arrêter" : "Écouter ce point"}
                            aria-label={`Écouter : ${st.label}`}
                            className={`p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity ${
                              isSnippetSpeaking
                                ? 'opacity-100 text-indigo-400'
                                : 'text-slate-400 hover:text-indigo-300'
                            }`}
                          >
                            <FontAwesomeIcon icon={isSnippetSpeaking ? faStop : faVolumeHigh} className="text-[10px]" />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">{insight.text}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {card.takeaway && (
              <div className="mt-2 pt-2.5 border-t border-slate-700/50">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-300 flex items-center gap-1.5">
                    <FontAwesomeIcon icon={faLightbulb} className="w-3 h-3 text-amber-400" />
                    <span>À retenir</span>
                  </div>
                  {isSpeechSupported && (
                    <button
                      type="button"
                      onClick={(e) => handleSpeakSnippet(e, `À retenir : ${card.takeaway}`)}
                      title="Écouter le point clé"
                      aria-label="Écouter le point clé"
                      className="text-slate-400 hover:text-indigo-300 p-1"
                    >
                      <FontAwesomeIcon
                        icon={
                          speechState.isSpeaking &&
                          speechState.currentText === `À retenir : ${card.takeaway}`
                            ? faStop
                            : faVolumeHigh
                        }
                        className="text-[10px]"
                      />
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{card.takeaway}</p>
              </div>
            )}

            {/* Boutons d'action : Approfondir (Niveau 2) + Démonstration */}
            <div className="pt-1 flex flex-col gap-2">
              {(onDeepDive || deepDive) && (
                <button
                  type="button"
                  onClick={handleDeepDiveClick}
                  disabled={isDeepDiveLoading}
                  aria-expanded={isDeepDiveExpanded}
                  className="w-full px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/90 hover:bg-slate-700/90 disabled:opacity-70 text-indigo-200 border border-indigo-500/35 transition-colors flex items-center justify-center gap-2"
                >
                  {isDeepDiveLoading ? (
                    <>
                      <span
                        className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"
                        aria-hidden="true"
                      />
                      <span>Analyse approfondie en cours…</span>
                    </>
                  ) : (
                    <>
                      <FontAwesomeIcon
                        icon={isDeepDiveExpanded ? faChevronUp : faChevronDown}
                        className="text-[11px]"
                        aria-hidden="true"
                      />
                      <span>{isDeepDiveExpanded ? "Replier l'approfondissement" : 'Approfondir'}</span>
                    </>
                  )}
                </button>
              )}

              {/* Zone d'approfondissement distincte (Niveau 2) */}
              {isDeepDiveExpanded && deepDive && (
                <section
                  aria-label="Analyse approfondie"
                  className="rounded-lg bg-slate-900/75 border border-indigo-500/30 p-3 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                      <FontAwesomeIcon icon={faCompass} className="w-3 h-3" aria-hidden="true" />
                      <span>Approfondissement</span>
                    </div>
                    {deepDive.degraded && (
                      <span className="text-[10px] text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded px-1.5 py-0.5">
                        Analyse déterministe locale
                      </span>
                    )}
                  </div>

                  {deepDive.summary && (
                    <p className="text-xs text-slate-200 font-medium leading-relaxed">
                      {deepDive.summary}
                    </p>
                  )}

                  <div className="space-y-2">
                    {deepDive.sections.map((sec, idx) => (
                      <div key={`${sec.title}-${idx}`} className="border-l-2 border-indigo-500/40 pl-2.5">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-200 mb-0.5">
                          {sec.title}
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">{sec.content}</p>
                      </div>
                    ))}
                  </div>

                  {deepDive.variants && deepDive.variants.length > 0 && (
                    <div className="pt-2 border-t border-slate-700/50 space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                        Variantes vérifiées
                      </div>
                      {deepDive.variants.map((variant, idx) => (
                        <p key={idx} className="text-[11px] text-slate-300 leading-relaxed">
                          {variant}
                        </p>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Bouton de démonstration coup par coup */}
              {canShowDemo && onShowDemo && (
                <button
                  onClick={() => onShowDemo(record)}
                  className="w-full px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/30 transition-colors flex items-center justify-center gap-2"
                >
                  <FontAwesomeIcon icon={faPlay} className="text-xs" aria-hidden="true" />
                  <span>Montrer sur l’échiquier</span>
                </button>
              )}
            </div>
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
