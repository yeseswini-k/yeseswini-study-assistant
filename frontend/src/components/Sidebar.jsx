import React from 'react';
import { LayoutDashboard, MessageSquare, BookOpen, Calendar, HelpCircle, ChevronLeft, ChevronRight } from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab }) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  const menuItems = [
    { id: 'chat', label: 'Study Chat', icon: MessageSquare },
    { id: 'tools', label: 'Study Tools', icon: BookOpen },
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'planner', label: 'Study Planner', icon: Calendar },
  ];

  return (
    <div className={`glass-panel border-white/5 flex transition-all duration-300 select-none z-30 relative
      fixed bottom-0 left-0 right-0 h-16 w-full flex-row border-t border-r-0 md:relative md:bottom-auto md:left-auto md:right-auto md:h-full md:flex-col md:border-r md:border-t-0 md:justify-between
      ${isCollapsed ? 'md:w-16' : 'md:w-60'}`}>
      {/* Collapse Toggle - Hidden on mobile */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="hidden md:flex absolute top-6 -right-3 w-6 h-6 rounded-full bg-slate-950 border border-gold/40 items-center justify-center text-gold hover:bg-gold hover:text-navy-950 transition-all shadow-lg hover:scale-105 active:scale-95"
      >
        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      {/* Main menu */}
      <div className="flex-1 flex flex-row justify-around items-center md:flex-col md:justify-start md:items-stretch py-2 px-3 md:py-6 md:space-y-6">
        {/* Navigation list */}
        <div className="flex flex-row md:flex-col justify-around w-full md:space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:py-3 rounded-xl transition-all duration-300 group text-left relative overflow-hidden ${
                  isActive 
                    ? 'bg-gradient-to-r from-gold-dark/20 to-gold/5 border border-gold/30 text-gold-light'
                    : 'hover:bg-white/5 border border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {/* Active Indicator Bar - Left on desktop, Top on mobile */}
                {isActive && (
                  <>
                    <div className="hidden md:block absolute left-0 top-0 bottom-0 w-1 bg-gold rounded-r-md"></div>
                    <div className="md:hidden absolute top-0 left-0 right-0 h-1 bg-gold rounded-b-md"></div>
                  </>
                )}
                
                <Icon className={`w-4 h-4 transition-all duration-300 group-hover:scale-110 ${isActive ? 'text-gold' : 'text-slate-400 group-hover:text-slate-200'}`} />
                {!isCollapsed && (
                  <span className="hidden md:inline text-xs font-semibold tracking-wider font-sans uppercase">
                    {item.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom info - Hidden on mobile */}
      <div className="hidden md:block p-4 border-t border-white/5">
        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : 'px-2'}`}>
          <HelpCircle className="w-4 h-4 text-slate-400 hover:text-slate-200 cursor-pointer transition-colors" />
          {!isCollapsed && (
            <div className="text-[9px] text-slate-500 leading-tight">
              <p className="font-semibold text-slate-400">Yeseswini's AI Study Assistant</p>
              <p className="mt-0.5">v1.0.0 • Local Storage</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
