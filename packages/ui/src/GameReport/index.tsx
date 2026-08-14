import React from 'react';

interface GameStats {
  accuracy: { white: number; black: number };
  acpl: { white: number; black: number };
  blunders: { white: number; black: number };
  mistakes: { white: number; black: number };
  inaccuracies: { white: number; black: number };
}

export interface GameReportProps {
  stats: GameStats | null;
  onClose?: () => void;
}

export const GameReport: React.FC<GameReportProps> = ({ stats, onClose }) => {
  if (!stats) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 shadow-2xl text-white w-full max-w-md">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
          <span>📊</span> Rapport de Partie
        </h2>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            ✕
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* White Stats */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-gray-700">
            <div className="w-4 h-4 bg-white rounded-sm border border-gray-300"></div>
            <span className="font-semibold text-lg">Blancs</span>
          </div>
          
          <div className="text-center bg-gray-800 p-4 rounded-lg">
            <div className="text-sm text-gray-400 mb-1">Précision</div>
            <div className="text-4xl font-bold text-green-400">{stats.accuracy.white}%</div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center bg-gray-800/50 px-3 py-2 rounded">
              <span className="text-blue-400 flex items-center gap-2"><span className="text-lg">?!</span> Imprécisions</span>
              <span className="font-bold">{stats.inaccuracies.white}</span>
            </div>
            <div className="flex justify-between items-center bg-gray-800/50 px-3 py-2 rounded">
              <span className="text-orange-400 flex items-center gap-2"><span className="text-lg">?</span> Erreurs</span>
              <span className="font-bold">{stats.mistakes.white}</span>
            </div>
            <div className="flex justify-between items-center bg-gray-800/50 px-3 py-2 rounded">
              <span className="text-red-500 flex items-center gap-2"><span className="text-lg">??</span> Gaffes</span>
              <span className="font-bold">{stats.blunders.white}</span>
            </div>
          </div>

          <div className="flex justify-between items-center text-sm text-gray-400 mt-2 px-1">
            <span>Perte Moy. (ACPL)</span>
            <span className="font-bold text-gray-200">{stats.acpl.white} cp</span>
          </div>
        </div>

        {/* Black Stats */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-gray-700">
            <div className="w-4 h-4 bg-black rounded-sm border border-gray-500"></div>
            <span className="font-semibold text-lg">Noirs</span>
          </div>
          
          <div className="text-center bg-gray-800 p-4 rounded-lg">
            <div className="text-sm text-gray-400 mb-1">Précision</div>
            <div className="text-4xl font-bold text-green-400">{stats.accuracy.black}%</div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center bg-gray-800/50 px-3 py-2 rounded">
              <span className="font-bold">{stats.inaccuracies.black}</span>
              <span className="text-blue-400 flex items-center gap-2">Imprécisions <span className="text-lg">?!</span></span>
            </div>
            <div className="flex justify-between items-center bg-gray-800/50 px-3 py-2 rounded">
              <span className="font-bold">{stats.mistakes.black}</span>
              <span className="text-orange-400 flex items-center gap-2">Erreurs <span className="text-lg">?</span></span>
            </div>
            <div className="flex justify-between items-center bg-gray-800/50 px-3 py-2 rounded">
              <span className="font-bold">{stats.blunders.black}</span>
              <span className="text-red-500 flex items-center gap-2">Gaffes <span className="text-lg">??</span></span>
            </div>
          </div>

          <div className="flex justify-between items-center text-sm text-gray-400 mt-2 px-1">
            <span className="font-bold text-gray-200">{stats.acpl.black} cp</span>
            <span>Perte Moy. (ACPL)</span>
          </div>
        </div>
      </div>
    </div>
  );
};
