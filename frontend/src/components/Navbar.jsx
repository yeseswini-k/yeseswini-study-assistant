import React from 'react';
import { Sparkles, Flame, CheckSquare, Settings, Activity, Sun, Moon } from 'lucide-react';

export default function Navbar({ streakCount, dailyGoalProgress, onOpenSettings, isOffline = false, theme, onToggleTheme }) {
  return (
    <nav className="glass-panel sticky top-0 left-0 right-0 z-40 border-b border-white/5 px-6 py-4 flex items-center justify-between shadow-lg">
      {/* Brand Logo */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-gold-dark/20 to-gold/10 border border-gold/30 gold-glow">
          <Sparkles className="w-5 h-5 text-gold" />
        </div>
        <div>
          <span className="font-academic text-base sm:text-lg font-bold tracking-wider text-gold-light">
            Yeseswini's AI Study Assistant
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          className="p-2.5 rounded-xl bg-slate-950/30 border border-white/10 hover:border-gold/40 text-slate-300 hover:text-white hover:bg-slate-950/60 transition-all hover:scale-105"
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-gold" /> : <Moon className="w-4 h-4 text-slate-600" />}
        </button>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="p-2.5 rounded-xl bg-slate-950/30 border border-white/10 hover:border-gold/40 text-slate-300 hover:text-white hover:bg-slate-950/60 transition-all hover:scale-105"
          title="Open settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </nav>
  );
}
