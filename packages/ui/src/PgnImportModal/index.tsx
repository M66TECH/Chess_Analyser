"use client";
import React, { useState, useCallback } from 'react';

export interface PgnImportModalProps {
  onImport: (pgn: string) => void;
  onClose: () => void;
}

export const PgnImportModal: React.FC<PgnImportModalProps> = ({ onImport, onClose }) => {
  const [text, setText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => {
    if (!file) return;
    if (!file.name.match(/\.pgn$/i) && file.type !== 'text/plain') {
      setError('Le fichier doit être au format PGN (.pgn)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result;
      if (typeof content === 'string') {
        setText(content);
        setError(null);
      }
    };
    reader.onerror = () => setError('Impossible de lire le fichier.');
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!text.trim()) {
      setError('Collez un PGN ou déposez un fichier.');
      return;
    }
    onImport(text);
  }, [text, onImport]);

  return (
    <div className="fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="glass-panel rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto custom-scrollbar"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <span>&#128194;</span> Importer une partie
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl" aria-label="Fermer">&#10005;</button>
        </div>

        {/* Drag & drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`border-2 border-dashed rounded-xl p-6 text-center mb-4 transition-colors cursor-pointer ${isDragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-600 hover:border-slate-500 bg-slate-900/40'}`}
          onClick={() => document.getElementById('pgn-file-input')?.click()}
        >
          <input
            id="pgn-file-input"
            type="file"
            accept=".pgn,.txt,text/plain"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <div className="text-3xl mb-2 opacity-70">&#128196;</div>
          <p className="text-sm text-slate-400">
            {isDragging ? 'Déposez le fichier ici' : 'Glissez-déposez un fichier .pgn ici, ou cliquez pour parcourir'}
          </p>
        </div>

        {/* Textarea */}
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          placeholder={'[Event "Ma partie"]\n[White "Moi"]\n[Black "Adversaire"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *'}
          className="w-full h-40 bg-slate-900/60 border border-slate-700/50 rounded-lg p-3 text-sm text-slate-200 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500/50 placeholder-slate-600"
          aria-label="Texte PGN à analyser"
        />

        {error && (
          <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleSubmit}
            className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold transition-all shadow-lg text-white border border-indigo-400/30"
          >
            Analyser la partie
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-700/50 text-slate-300"
          >
            Annuler
          </button>
        </div>

        <p className="text-xs text-slate-500 mt-3 text-center">
          Seule la ligne principale est analysée. Les variantes seront disponibles prochainement.
        </p>
      </div>
    </div>
  );
};
