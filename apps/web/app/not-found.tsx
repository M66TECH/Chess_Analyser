import React from 'react';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChessBoard, faArrowLeft } from '@fortawesome/free-solid-svg-icons';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950 text-slate-100">
      <div className="max-w-md w-full glass-panel rounded-2xl p-6 sm:p-8 text-center border border-slate-800 shadow-2xl space-y-5">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 text-3xl">
          <FontAwesomeIcon icon={faChessBoard} />
        </div>

        <div className="space-y-2">
          <h2 className="text-3xl font-extrabold tracking-tight text-white font-mono">
            404
          </h2>
          <h3 className="text-lg font-semibold text-slate-200">
            Case introuvable
          </h3>
          <p className="text-sm text-slate-400">
            Cette position ou cette page n&apos;existe pas sur cet échiquier.
          </p>
        </div>

        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-indigo-500/20"
          >
            <FontAwesomeIcon icon={faArrowLeft} className="text-xs" />
            <span>Retour à l&apos;analyse</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
