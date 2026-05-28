import React, { useState } from 'react';
import { Calendar, Sparkles, Loader2, BookOpen, Clock, Download, CheckSquare, Settings } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// Preprocessor to normalize LaTeX delimiters for reliable KaTeX rendering
const preprocessMarkdown = (text) => {
  if (!text) return '';
  
  let processed = text;
  
  // Clean up double backslashes in LaTeX commands (e.g. \\frac -> \frac)
  // This preserves double backslashes used for newlines in matrices/aligned blocks because they are followed by space, newline, or non-alphabetic chars.
  processed = processed.replace(/\\\\([a-zA-Z])/g, '\\$1');
  
  // Replace block math delimiters \[ ... \] or \\[ ... \\] with $$ ... $$
  processed = processed.replace(/(?:\\\\\[|\\\[)([\s\S]*?)(?:\\\\\]|\\\])/g, (_, equation) => {
    return `\n$$\n${equation.trim()}\n$$\n`;
  });
  
  // Replace inline math delimiters \( ... \) or \\( ... \\) with $ ... $
  processed = processed.replace(/(?:\\\\\(|\\\()([\s\S]*?)(?:\\\\\)|\\\))/g, (_, equation) => {
    return `$${equation}$`;
  });
  
  // Ensure block math $$ is on its own line
  processed = processed.replace(/\$\$(.*?)\$\$/g, (_, equation) => {
    return `\n$$\n${equation.trim()}\n$$\n`;
  });
  
  return processed;
};
import { generateStudyPlan, exportNotes } from '../utils/api';

export default function StudyPlanner({ documents }) {
  const [selectedDocs, setSelectedDocs] = useState([]);
  const [timeframe, setTimeframe] = useState(4); // 4 weeks default
  const [dailyHours, setDailyHours] = useState(2); // 2 hours default
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [planData, setPlanData] = useState('');

  const toggleDocSelection = (filename) => {
    setSelectedDocs(prev => 
      prev.includes(filename) 
        ? prev.filter(f => f !== filename) 
        : [...prev, filename]
    );
  };

  const handleGeneratePlan = async (e) => {
    e.preventDefault();
    if (selectedDocs.length === 0) {
      setError('Please select at least one document to construct the plan.');
      return;
    }
    setLoading(true);
    setError('');
    setPlanData('');

    try {
      const res = await generateStudyPlan(selectedDocs, timeframe, dailyHours);
      setPlanData(res.planner);
    } catch (e) {
      if (e.message === 'Failed to fetch') {
        setError('Failed to connect to the backend server. Please make sure the Python server is running on http://localhost:8000.');
      } else {
        setError(e.message || 'Error generating schedule.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = async () => {
    if (!planData) return;
    try {
      await exportNotes(planData, `AI Study Schedule - ${selectedDocs.slice(0,2).join(', ')}`);
    } catch (e) {
      setError('Failed to export plan to PDF');
    }
  };

  const MarkdownRenderer = ({ text }) => {
    const processedText = preprocessMarkdown(text);
    return (
      <div className="markdown-body leading-relaxed text-slate-200 text-xs sm:text-sm">
        <ReactMarkdown 
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {processedText}
        </ReactMarkdown>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-6 space-y-6 h-full relative z-10">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-academic font-bold text-gold-light tracking-wide flex items-center gap-2">
            <Calendar className="w-7 h-7 text-gold" />
            AI Study Planner & Scheduler
          </h1>
          <p className="text-xs text-slate-400 mt-1">Design daily learning curriculums mapped to indexed PDF topics.</p>
        </div>
      </div>

      {error && (
        <div className="bg-rose-950/25 border border-rose-500/20 text-rose-400 px-4 py-2.5 rounded-xl text-xs">
          {error}
        </div>
      )}

      {/* Grid structure: Setup form & schedule view */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Planner Configurator Form - Left (4 cols) */}
        <div className="lg:col-span-4 bg-navy-900/10">
          <div className="glass-card rounded-2xl p-5 space-y-5">
            <h3 className="font-academic text-sm font-bold text-gold-light border-b border-white/5 pb-2.5 flex items-center gap-2">
              <Settings className="w-4 h-4 text-gold" />
              Schedule Scope
            </h3>
            
            <form onSubmit={handleGeneratePlan} className="space-y-5">
              {/* Document selection */}
              <div>
                <label className="block text-[9px] uppercase font-bold text-slate-500 tracking-wider mb-2">Select Study Files</label>
                {documents.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-1">No documents indexed yet. Upload PDFs first.</p>
                ) : (
                  <div className="max-h-[160px] overflow-y-auto space-y-1.5 border border-white/5 rounded-xl p-2.5 bg-slate-950/20">
                    {documents.map((doc, idx) => {
                      const isSelected = selectedDocs.includes(doc.filename);
                      return (
                        <div 
                          key={idx} 
                          onClick={() => toggleDocSelection(doc.filename)}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 text-xs border ${
                            isSelected
                              ? 'bg-gold/10 text-gold-light border-gold/40'
                              : 'hover:bg-white/5 text-slate-400 border-transparent'
                          }`}
                        >
                          <BookOpen className={`w-3.5 h-3.5 ${isSelected ? 'text-gold' : 'text-slate-500'}`} />
                          <span className="truncate">{doc.filename}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Timeframe slider */}
              <div>
                <label className="block text-[9px] uppercase font-bold text-slate-500 tracking-wider mb-2 flex justify-between">
                  <span>Duration</span>
                  <span className="text-gold font-bold">{timeframe} Weeks</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="12"
                  value={timeframe}
                  onChange={(e) => setTimeframe(parseInt(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-gold"
                />
              </div>

              {/* Commitment hours */}
              <div>
                <label className="block text-[9px] uppercase font-bold text-slate-500 tracking-wider mb-2 flex justify-between">
                  <span>Daily Study Commitment</span>
                  <span className="text-gold font-bold">{dailyHours} Hours/Day</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="8"
                  value={dailyHours}
                  onChange={(e) => setDailyHours(parseInt(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-gold"
                />
              </div>

              <button
                type="submit"
                disabled={loading || documents.length === 0}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-gold-dark to-gold text-navy-950 font-bold shadow-lg hover:opacity-90 hover:scale-[1.01] active:scale-95 transition-all duration-150 text-xs flex items-center justify-center gap-1.5"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Analyzing contents...</span>
                  </>
                ) : (
                  <>
                    <Calendar className="w-4 h-4 fill-navy-950 stroke-[2px]" />
                    <span>Generate AI Schedule</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Schedule Display - Right (8 cols) */}
        <div className="lg:col-span-8">
          <div className="glass-card rounded-2xl p-6 h-[500px] overflow-y-auto relative flex flex-col justify-between">
            
            {loading ? (
              <div className="h-full flex flex-col items-center justify-center space-y-4 py-20">
                <Loader2 className="w-8 h-8 text-gold animate-spin" />
                <p className="text-xs text-slate-400 italic">Synthesizing calendar structures using Groq LLM...</p>
              </div>
            ) : planData ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex justify-between items-center pb-3 border-b border-white/5 mb-5 flex-shrink-0">
                  <h3 className="font-academic text-base font-bold text-gold-light">Weekly Learning Curriculum</h3>
                  <button
                    onClick={handleExportPDF}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gold text-navy-950 font-bold shadow-lg hover:bg-gold/90 transition text-xs hover:scale-105 active:scale-95 duration-150"
                  >
                    <Download className="w-3.5 h-3.5 stroke-[2.5px]" />
                    <span>Save Plan to PDF</span>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto pr-1">
                  <MarkdownRenderer text={planData} />
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto py-20">
                <div className="p-4 rounded-full bg-slate-950/40 border border-white/5 shadow-inner">
                  <Calendar className="w-7 h-7 text-slate-600 animate-pulse" />
                </div>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed italic">
                  Select documents, set week constraints, and hit 'Generate AI Schedule' to lay out your curriculum.
                </p>
              </div>
            )}

          </div>
        </div>

      </div>

    </div>
  );
}
