import React from 'react';
import { Sparkles, Sun, Moon, Settings, LogOut } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../utils/supabase';

export default function Navbar({ streakCount, dailyGoalProgress, onOpenSettings, isOffline = false, theme, onToggleTheme, user }) {
  const handleLogout = async () => {
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.auth.signOut();
        // Clear local storage sessions to isolate users completely
        localStorage.removeItem('study_chat_sessions');
        localStorage.removeItem('study_streak_count');
        localStorage.removeItem('study_goal_progress');
        window.location.reload();
      } catch (error) {
        console.error("Sign out error:", error);
      }
    }
  };

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
        {/* User email display (optional/subtle) */}
        {isSupabaseConfigured && user && user.email && (
          <span className="hidden sm:inline text-xs text-slate-400 font-light border-r border-white/10 pr-3 mr-1">
            {user.email}
          </span>
        )}
        
        {isSupabaseConfigured && user && !user.email && (
          <span className="hidden sm:inline text-xs text-slate-500 font-light border-r border-white/10 pr-3 mr-1">
            Guest Session
          </span>
        )}

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

        {/* Log Out button if authenticated */}
        {isSupabaseConfigured && user && (
          <button
            onClick={handleLogout}
            className="p-2.5 rounded-xl bg-rose-950/20 border border-rose-500/10 hover:border-rose-500/40 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 transition-all hover:scale-105"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </nav>
  );
}
