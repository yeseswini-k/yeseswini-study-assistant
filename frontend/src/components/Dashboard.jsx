import React, { useState, useRef } from 'react';
import { FileText, Award, BookOpen, Trash2, Library, ChevronRight, UploadCloud, Loader2 } from 'lucide-react';
import { deleteDocument, listDocuments, uploadFiles } from '../utils/api';

export default function Dashboard({ 
  documents, 
  setDocuments, 
  onUpdateStreak, 
  streakCount, 
  sessions, 
  setActiveSessionId, 
  setActiveTab 
}) {

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  const handleFileInputChange = (e) => {
    if (e.target.files) {
      handleFileUpload(Array.from(e.target.files));
    }
  };

  const handleFileUpload = async (files) => {
    setUploading(true);
    setUploadError('');
    try {
      const response = await uploadFiles(files, 1000, 200);
      const results = response.results || [];
      const successfullyIndexed = [];
      let uploadErrors = [];

      results.forEach(res => {
        if (res.status === 'success' || res.status === 'ocr_preview_required') {
          successfullyIndexed.push(res.filename);
        } else if (res.status === 'error') {
          uploadErrors.push(`${res.filename}: ${res.message}`);
        }
      });

      if (successfullyIndexed.length > 0) {
        const docs = await listDocuments();
        setDocuments(docs);
      }
      if (uploadErrors.length > 0) {
        setUploadError(uploadErrors.join('; '));
      }
    } catch (err) {
      setUploadError(err.message || 'Error indexing documents.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (filename, e) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete '${filename}'?`)) {
      try {
        await deleteDocument(filename);
        const docs = await listDocuments();
        setDocuments(docs);
      } catch (err) {
        console.error("Error deleting document:", err);
      }
    }
  };

  const handleRecentSessionClick = (sessId) => {
    setActiveSessionId(sessId);
    setActiveTab('chat');
  };

  // Calculate statistics
  const totalPages = documents.reduce((acc, curr) => acc + (curr.pages || 0), 0);
  const totalSize = (documents.reduce((acc, curr) => acc + (curr.size_bytes || 0), 0) / (1024 * 1024)).toFixed(2);

  return (
    <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-6 space-y-6 h-full relative z-10">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-academic font-bold text-gold-light tracking-wide flex items-center gap-2">
            <Library className="w-7 h-7 text-gold" />
            Dashboard
          </h1>
          <p className="text-xs text-slate-400 mt-1">Sleek overview of your study statistics and active sessions.</p>
        </div>
      </div>

      {/* Row 1: Simple Analytics Cards */}
      <div className="grid grid-cols-1 gap-6">
        {/* Card 1: Library Stats */}
        <div className="glass-card rounded-2xl p-6 flex items-center gap-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gold/5 rounded-full blur-2xl pointer-events-none"></div>
          <div className="p-4 rounded-xl bg-gold/10 border border-gold/20 flex-shrink-0">
            <FileText className="w-8 h-8 text-gold" />
          </div>
          <div>
            <h4 className="text-xs uppercase font-bold tracking-widest text-slate-400">Library Files</h4>
            <p className="text-3xl font-bold font-sans text-white mt-1">{documents.length}</p>
            <p className="text-xs text-slate-500 mt-1">{totalPages} Total Pages • {totalSize} MB Indexed</p>
          </div>
        </div>
      </div>

      {/* Row 2: Grid for Documents List & Recent Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Document Stats & Index Overview */}
        <div className="glass-card rounded-2xl p-6 flex flex-col justify-between min-h-[300px]">
          <div>
            <h3 className="font-academic text-base font-bold text-gold-light border-b border-white/5 pb-3 mb-4">
              Library Files List
            </h3>
            
            {documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Library className="w-10 h-10 text-slate-700 mb-3" />
                <p className="text-sm text-slate-500 italic mb-4">No files uploaded yet.</p>
                <div 
                  onClick={() => fileInputRef.current.click()}
                  className="border border-dashed border-white/10 hover:border-gold/30 hover:bg-white/5 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all bg-slate-950/20 max-w-xs w-full"
                >
                  <input
                    type="file"
                    multiple
                    accept=".pdf, .jpg, .jpeg, .png, image/*"
                    ref={fileInputRef}
                    onChange={handleFileInputChange}
                    className="hidden"
                  />
                  {uploading ? (
                    <div className="flex items-center gap-2 py-1">
                      <Loader2 className="w-4 h-4 text-gold animate-spin" />
                      <span className="text-[10px] text-slate-300 font-medium font-sans">Processing file...</span>
                    </div>
                  ) : (
                    <>
                      <UploadCloud className="w-6 h-6 text-gold mb-1" />
                      <span className="text-[9px] text-slate-300 font-semibold font-sans">Upload PDF / Image</span>
                      <span className="text-[8px] text-slate-500 mt-0.5 font-sans">Click or drag & drop</span>
                    </>
                  )}
                </div>
                {uploadError && <p className="text-[9px] text-rose-400 mt-1.5 bg-rose-950/20 border border-rose-500/20 px-2.5 py-1 rounded-lg truncate max-w-xs">{uploadError}</p>}
              </div>
            ) : (
              <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
                {documents.map((doc, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-slate-950/50 border border-white/5 hover:border-gold/15 rounded-xl px-4 py-3 text-xs transition-all duration-200">
                    <div className="flex items-center gap-3 overflow-hidden mr-2">
                      <div className="p-2 rounded bg-gold/5 border border-gold/10 flex-shrink-0">
                        <FileText className="w-4 h-4 text-gold" />
                      </div>
                      <div className="overflow-hidden">
                        <p className="truncate text-slate-200 font-semibold font-sans text-xs" title={doc.filename}>{doc.filename}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{doc.pages} pages • {((doc.size_bytes || 0) / 1024).toFixed(0)} KB</p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDelete(doc.filename, e)}
                      className="p-2 rounded-lg hover:bg-rose-950/30 text-slate-400 hover:text-rose-400 transition-colors flex-shrink-0"
                      title="Delete Document"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-4 text-center">Library files provide the context study materials for Yeseswini's AI Study Assistant.</p>
        </div>

        {/* Recent Sessions list */}
        <div className="glass-card rounded-2xl p-6 flex flex-col justify-between min-h-[300px]">
          <div>
            <h3 className="font-academic text-base font-bold text-gold-light border-b border-white/5 pb-3 mb-4">
              Recent Sessions
            </h3>

            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <BookOpen className="w-10 h-10 text-slate-700 mb-3" />
                <p className="text-sm text-slate-500 italic">No study sessions found. Create a new one inside Study Chat.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
                {sessions.map((sess) => (
                  <div 
                    key={sess.id}
                    onClick={() => handleRecentSessionClick(sess.id)}
                    className="flex justify-between items-center bg-slate-950/50 border border-white/5 hover:border-gold/15 hover:bg-white/5 rounded-xl px-4 py-3.5 text-xs transition-all duration-200 cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="p-2 rounded bg-gold/5 border border-gold/10 text-gold flex-shrink-0">
                        <BookOpen className="w-4 h-4" />
                      </div>
                      <div className="overflow-hidden">
                        <p className="truncate text-slate-200 font-semibold group-hover:text-gold-light transition-colors">{sess.title}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{sess.messages.length} messages in history</p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-gold group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-4 text-center">Select any recent session to load its history and continue studying.</p>
        </div>

      </div>

    </div>
  );
}
