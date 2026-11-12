'use client';

import React, { useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTriangleExclamation, faRotateRight } from '@fortawesome/free-solid-svg-icons';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[ErrorPage]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950 text-slate-100">
      <div className="max-w-md w-full glass-panel rounded-2xl p-6 sm:p-8 text-center border border-red-500/30 shadow-2xl space-y-5">
        <div className="w-14 h-14 mx-auto rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 text-2xl">
          <FontAwesomeIcon icon={faTriangleExclamation} />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold tracking-tight text-white">
            Une erreur inattendue est survenue
          </h2>
          <p className="text-sm text-slate-400">
            L&apos;application a rencontré un problème lors de l&apos;exécution. Vos données locales sont préservées.
          </p>
          {error.message && (
            <div className="mt-3 p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-xs font-mono text-slate-400 break-words text-left max-h-28 overflow-y-auto">
              {error.message}
            </div>
          )}
        </div>

        <div className="flex justify-center gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg flex items-center gap-2"
          >
            <FontAwesomeIcon icon={faRotateRight} className="text-xs" />
            <span>Réessayer</span>
          </button>
          <a
            href="/"
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition-all border border-slate-700/50"
          >
            Accueil
          </a>
        </div>
      </div>
    </div>
  );
}
