import React from 'react';

export default function Loading() {
  return (
    <div className="min-h-screen w-full flex flex-col bg-slate-950 animate-pulse">
      {/* Skeleton NavigationBar */}
      <div className="h-14 border-b border-slate-800/60 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-slate-800 rounded-lg" />
          <div className="space-y-1.5 hidden sm:block">
            <div className="w-24 h-3 bg-slate-800 rounded" />
            <div className="w-16 h-2 bg-slate-800/60 rounded" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-20 h-8 bg-slate-800 rounded-lg" />
          <div className="w-20 h-8 bg-slate-800 rounded-lg" />
          <div className="w-8 h-8 bg-slate-800 rounded-lg" />
        </div>
      </div>

      {/* Skeleton Content */}
      <div className="flex-1 max-w-[1450px] w-full mx-auto p-4 xl:p-6 flex flex-col xl:flex-row gap-6 items-start justify-center">
        {/* Board column */}
        <div className="flex flex-col gap-4 w-full xl:w-auto items-center xl:items-start">
          <div className="flex gap-3">
            <div className="w-6 h-[480px] bg-slate-800/60 rounded-lg" />
            <div className="w-[340px] sm:w-[480px] aspect-square bg-slate-900 border border-slate-800 rounded-xl" />
          </div>
          <div className="w-full max-w-[510px] h-12 bg-slate-800/40 rounded-xl" />
        </div>

        {/* Moves column */}
        <div className="hidden xl:flex flex-col gap-4 w-[300px]">
          <div className="h-[460px] bg-slate-900/60 border border-slate-800 rounded-xl" />
          <div className="h-[280px] bg-slate-900/60 border border-slate-800 rounded-xl" />
        </div>

        {/* Coach column */}
        <div className="hidden xl:flex flex-col gap-4 w-[400px]">
          <div className="h-[420px] bg-slate-900/60 border border-slate-800 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
