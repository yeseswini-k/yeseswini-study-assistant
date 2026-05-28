import React from 'react';
import { X, Sliders, KeyRound, Check } from 'lucide-react';

export default function SettingsModal({ isOpen, onClose, settings, onSave }) {
  if (!isOpen) return null;

  const [topK, setTopK] = React.useState(settings.topK || 4);
  const [chunkSize, setChunkSize] = React.useState(settings.chunkSize || 1000);
  const [chunkOverlap, setChunkOverlap] = React.useState(settings.chunkOverlap || 200);
  const [customKey, setCustomKey] = React.useState(localStorage.getItem('GROQ_API_KEY_OVERRIDE') || '');
  const [saved, setSaved] = React.useState(false);

  const handleSave = (e) => {
    e.preventDefault();
    if (customKey) {
      localStorage.setItem('GROQ_API_KEY_OVERRIDE', customKey);
    } else {
      localStorage.removeItem('GROQ_API_KEY_OVERRIDE');
    }
    
    onSave({
      topK: parseInt(topK),
      chunkSize: parseInt(chunkSize),
      chunkOverlap: parseInt(chunkOverlap)
    });

    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-panel w-full max-w-md rounded-2xl border border-gold/30 shadow-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-gold/5 rounded-full blur-2xl pointer-events-none"></div>
        
        {/* Header */}
        <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-gold" />
            <h3 className="text-lg font-semibold font-academic tracking-wide text-gold-light">Study Settings</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="space-y-5">
          {/* Top-K Retrieval Setting */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gold-light/80 mb-2">
              Retrieval Top-K Chunks ({topK})
            </label>
            <input
              type="range"
              min="2"
              max="12"
              value={topK}
              onChange={(e) => setTopK(e.target.value)}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-gold"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>Fewer (faster)</span>
              <span>More (thorough)</span>
            </div>
          </div>

          {/* Chunking Parameters */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gold-light/80 mb-2">
                Chunk Size (chars)
              </label>
              <input
                type="number"
                value={chunkSize}
                onChange={(e) => setChunkSize(e.target.value)}
                className="glass-input w-full px-3 py-2 text-sm rounded-lg"
                min="200"
                max="4000"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gold-light/80 mb-2">
                Chunk Overlap
              </label>
              <input
                type="number"
                value={chunkOverlap}
                onChange={(e) => setChunkOverlap(e.target.value)}
                className="glass-input w-full px-3 py-2 text-sm rounded-lg"
                min="0"
                max="1000"
              />
            </div>
          </div>

          {/* Custom API Key Override */}
          <div className="border-t border-white/10 pt-4">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gold-light/80 mb-2">
              <KeyRound className="w-3.5 h-3.5 text-gold" />
              Groq API Key Override
            </label>
            <input
              type="password"
              placeholder="Leave empty to use server's default .env key"
              value={customKey}
              onChange={(e) => setCustomKey(e.target.value)}
              className="glass-input w-full px-3 py-2 text-sm rounded-lg placeholder-slate-500"
            />
            <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
              If provided, this key runs queries directly in your browser. Stored securely in local storage.
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-3 border-t border-white/10 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs rounded-lg font-medium hover:bg-white/5 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saved}
              className="px-4 py-2 text-xs rounded-lg font-medium bg-gradient-to-r from-gold-dark to-gold text-navy-950 shadow-lg gold-glow-hover hover:opacity-90 transition flex items-center gap-1.5"
            >
              {saved ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Saved!
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
