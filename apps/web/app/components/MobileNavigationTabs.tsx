'use client';

import React from 'react';

export type MobilePanelTab = 'coach' | 'moves' | 'explorer';

export interface MobileNavigationTabsProps {
  activePanel: MobilePanelTab;
  onSelectPanel: (panel: MobilePanelTab) => void;
}

export function MobileNavigationTabs({ activePanel, onSelectPanel }: MobileNavigationTabsProps) {
  const tabs: Array<{ id: MobilePanelTab; label: string }> = [
    { id: 'coach', label: 'Coach' },
    { id: 'moves', label: 'Coups' },
    { id: 'explorer', label: 'Base' },
  ];

  return (
    <div className="xl:hidden flex gap-1 glass-panel rounded-lg p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelectPanel(tab.id)}
          aria-pressed={activePanel === tab.id}
          className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            activePanel === tab.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
