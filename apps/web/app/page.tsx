"use client";
import dynamic from 'next/dynamic';

const ChessBoard = dynamic(
  () => import('@chess-analyzer/ui').then((mod) => mod.ChessBoard),
  { ssr: false, loading: () => <div className="h-[600px] w-full flex items-center justify-center bg-slate-900 rounded border border-slate-700 text-slate-400">Chargement de l'échiquier...</div> }
);

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-8">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold mb-2">Next-Gen Chess Analyzer</h1>
        <p className="text-slate-400">Dashboard de précision et analyse avancée.</p>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-slate-800 p-6 rounded-xl shadow-2xl border border-slate-700">
          <ChessBoard fen="start" />
        </div>
        
        <div className="bg-slate-800 p-6 rounded-xl shadow-xl border border-slate-700 flex flex-col space-y-4">
          <h2 className="text-2xl font-semibold">Analyse</h2>
          <div className="flex-1 bg-slate-900 rounded p-4 text-sm font-mono text-slate-300">
            <p>En attente du moteur...</p>
          </div>
          <button className="w-full bg-blue-600 hover:bg-blue-700 transition-colors py-3 rounded font-medium">
            Lancer l'analyse locale
          </button>
        </div>
      </main>
    </div>
  );
}
