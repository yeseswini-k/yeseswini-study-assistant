import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ChatInterface from './components/ChatInterface';
import Tools from './components/Tools';
import StudyPlanner from './components/StudyPlanner';
import SettingsModal from './components/SettingsModal';
import FloatingParticles from './components/FloatingParticles';
import { listDocuments, API_BASE_URL } from './utils/api';
import Auth from './components/Auth';
import { supabase, isSupabaseConfigured } from './utils/supabase';
import { Sparkles, Loader } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthLoading(false);
      return;
    }
    
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const [activeTab, setActiveTab] = useState('chat');
  const [documents, setDocumentsState] = useState([]);
  const setDocuments = (docsOrFn) => {
    if (typeof docsOrFn === 'function') {
      setDocumentsState(prev => {
        const next = docsOrFn(prev);
        return next.filter(d => {
          const name = d.filename.toLowerCase();
          return !(name.includes('test') || name.includes('ocr_test') || name.includes('tmp') || name.includes('cache'));
        });
      });
    } else {
      const userDocs = docsOrFn.filter(d => {
        const name = d.filename.toLowerCase();
        return !(name.includes('test') || name.includes('ocr_test') || name.includes('tmp') || name.includes('cache'));
      });
      setDocumentsState(userDocs);
    }
  };
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('study_theme') || 'light';
  });

  // Sync theme class to document body and html elements
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light-theme');
      document.body.classList.add('light-theme');
    } else {
      document.documentElement.classList.remove('light-theme');
      document.body.classList.remove('light-theme');
    }
  }, [theme]);

  // Lifted Chat Sessions State
  const [sessions, setSessions] = useState(() => {
    const saved = localStorage.getItem('study_chat_sessions');
    return saved ? JSON.parse(saved) : [{ id: 'default', title: 'Calculus Review Session', messages: [] }];
  });
  const [activeSessionId, setActiveSessionId] = useState(() => {
    const saved = localStorage.getItem('study_chat_sessions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.length > 0) {
          return parsed[0].id;
        }
      } catch (e) {}
    }
    return 'default';
  });

  // Sync sessions to localStorage
  useEffect(() => {
    localStorage.setItem('study_chat_sessions', JSON.stringify(sessions));
  }, [sessions]);

  const handleToggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('study_theme', next);
      return next;
    });
  };
  
  // Streak & Goals stats tracking
  const [streakCount, setStreakCount] = useState(() => {
    const saved = localStorage.getItem('study_streak_count');
    return saved ? parseInt(saved) : 3;
  });
  const [dailyGoalProgress, setDailyGoalProgress] = useState(() => {
    const saved = localStorage.getItem('study_goal_progress');
    return saved ? parseFloat(saved) : 33.3;
  });

  const [notesContent, setNotesContent] = useState('');

  // Settings
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('study_rag_settings');
    return saved ? JSON.parse(saved) : { topK: 4, chunkSize: 1000, chunkOverlap: 200 };
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [explanationMode, setExplanationMode] = useState(() => {
    return localStorage.getItem('study_explanation_mode') || 'intermediate';
  });
  const [responseDepth, setResponseDepth] = useState(() => {
    return localStorage.getItem('study_response_depth') || 'standard';
  });

  const handleUpdateExplanationMode = (mode) => {
    setExplanationMode(mode);
    localStorage.setItem('study_explanation_mode', mode);
  };

  const handleUpdateResponseDepth = (depth) => {
    setResponseDepth(depth);
    localStorage.setItem('study_response_depth', depth);
  };

  // Synchronize initial data
  useEffect(() => {
    const checkConnection = async () => {
      if (authLoading) return;
      if (isSupabaseConfigured && !user) return;

      try {
        const response = await fetch(`${API_BASE_URL}/api/health`);
        if (response.ok) {
          setIsOffline(false);
          const docs = await listDocuments();
          setDocuments(docs);
        } else {
          setIsOffline(true);
        }
      } catch (e) {
        setIsOffline(true);
      }
    };
    checkConnection();
  }, [user, authLoading]);

  const handleUpdateStreak = () => {
    setStreakCount(prev => {
      const next = prev + 1;
      localStorage.setItem('study_streak_count', next.toString());
      return next;
    });
  };

  const handleUpdateGoals = (progress) => {
    setDailyGoalProgress(progress);
    localStorage.setItem('study_goal_progress', progress.toString());
  };

  const handleSaveSettings = (newSettings) => {
    setSettings(newSettings);
    localStorage.setItem('study_rag_settings', JSON.stringify(newSettings));
  };

  if (authLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-navy-950 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,#2a2015_0%,#0c0a09_70%)]" />
        <div className="z-10 flex flex-col items-center gap-3">
          <div className="p-3.5 rounded-2xl bg-gradient-to-br from-gold-dark/20 to-gold/5 border border-gold/30 gold-glow mb-2 animate-bounce">
            <Sparkles className="w-8 h-8 text-gold" />
          </div>
          <Loader className="w-6 h-6 text-gold animate-spin" />
          <span className="text-slate-400 text-xs font-light tracking-wide">Syncing study environment...</span>
        </div>
      </div>
    );
  }

  if (isSupabaseConfigured && !user) {
    return <Auth onAuthSuccess={() => {}} theme={theme} onToggleTheme={handleToggleTheme} />;
  }

  return (
    <div className={`h-full flex flex-col overflow-hidden font-sans select-none relative transition-colors duration-300 ${
      theme === 'light' ? 'light-theme bg-slate-50' : 'bg-navy-950'
    }`}>
      {/* Luxury Background Canvas Particles */}
      <FloatingParticles />

      {/* Header bar */}
      <Navbar 
        streakCount={streakCount} 
        dailyGoalProgress={dailyGoalProgress} 
        onOpenSettings={() => setSettingsOpen(true)}
        isOffline={isOffline}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        user={user}
      />

      {/* Main app body */}
      <div className="flex-1 flex flex-col-reverse md:flex-row overflow-hidden relative pb-16 md:pb-0">
        {/* Navigation Sidebar */}
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

        {/* Content body switcher */}
        <main className="flex-1 h-full flex flex-col overflow-hidden relative">
          {activeTab === 'dashboard' && (
            <Dashboard 
              documents={documents} 
              setDocuments={setDocuments} 
              onUpdateStreak={handleUpdateStreak}
              onUpdateGoals={handleUpdateGoals}
              streakCount={streakCount}
              sessions={sessions}
              setActiveSessionId={setActiveSessionId}
              setActiveTab={setActiveTab}
            />
          )}

          {activeTab === 'chat' && (
            <ChatInterface 
              documents={documents} 
              setDocuments={setDocuments}
              ragSettings={settings}
              sessions={sessions}
              setSessions={setSessions}
              activeSessionId={activeSessionId}
              setActiveSessionId={setActiveSessionId}
              explanationMode={explanationMode}
              setExplanationMode={handleUpdateExplanationMode}
              responseDepth={responseDepth}
              setResponseDepth={handleUpdateResponseDepth}
              notesContent={notesContent}
              setNotesContent={setNotesContent}
            />
          )}

          {activeTab === 'tools' && (
            <Tools 
              documents={documents} 
              setDocuments={setDocuments}
              explanationMode={explanationMode} 
              responseDepth={responseDepth}
              setResponseDepth={handleUpdateResponseDepth}
              notesContent={notesContent}
              setNotesContent={setNotesContent}
            />
          )}

          {activeTab === 'planner' && (
            <StudyPlanner documents={documents} />
          )}
        </main>
      </div>

      {/* Config Overlay */}
      <SettingsModal 
        isOpen={settingsOpen} 
        onClose={() => setSettingsOpen(false)} 
        settings={settings}
        onSave={handleSaveSettings}
      />
    </div>
  );
}
