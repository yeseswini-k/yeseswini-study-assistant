import React, { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, BookOpen, Trash2, Plus, Copy, Check, Download, Layers, PanelLeft, PanelLeftClose, PanelRight, ChevronRight, User, Terminal, HelpCircle, FileText, Edit3, UploadCloud, CheckSquare, Square, ChevronDown, ChevronUp, Loader2, Search, X, AlertTriangle, Image as ImageIcon, CheckCircle2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// Helper to get formatted date/time in India Standard Time (IST)
const getISTTimestamp = () => {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  const parts = formatter.formatToParts(date);
  let day = '', month = '', year = '', hour = '', minute = '', dayPeriod = '';
  
  for (const part of parts) {
    if (part.type === 'day') day = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'year') year = part.value;
    else if (part.type === 'hour') hour = part.value;
    else if (part.type === 'minute') minute = part.value;
    else if (part.type === 'dayPeriod') dayPeriod = part.value.toUpperCase();
  }
  
  return `${day} ${month} ${year}, ${hour}:${minute} ${dayPeriod} IST`;
};

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
import { streamChat, uploadFiles, listDocuments, indexText, correctOcrText, API_BASE_URL, exportChat, exportNotes } from '../utils/api';

// Helper to parse toast message text and status type
const parseToastMessage = (msg) => {
  if (!msg) return { text: '', isError: false };
  let text = msg;
  let isError = false;
  if (text.startsWith('✅')) {
    text = text.substring(1).trim();
    isError = false;
  } else if (text.startsWith('⚠') || text.startsWith('❌')) {
    text = text.replace(/^[⚠❌]/, '').trim();
    isError = true;
  } else if (
    text.toLowerCase().includes('fail') || 
    text.toLowerCase().includes('error') || 
    text.toLowerCase().includes('unable') || 
    text.toLowerCase().includes('not enough')
  ) {
    isError = true;
  }
  return { text, isError };
};

export default function ChatInterface({ 
  documents, 
  setDocuments,
  ragSettings, 
  sessions, 
  setSessions, 
  activeSessionId, 
  setActiveSessionId,
  explanationMode,
  setExplanationMode,
  notesContent,
  setNotesContent,
  responseDepth,
  setResponseDepth
}) {
  // Navigation sidebar & citations sidebars toggles
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [activeCitationsTab, setActiveCitationsTab] = useState(false);
  
  // Document multi-select filters
  const [selectedDocs, setSelectedDocs] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);
  
  // Drag & drop upload states
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  // States for OCR Flow
  const [ocrQueue, setOcrQueue] = useState([]);
  const [ocrPreviewDoc, setOcrPreviewDoc] = useState(null);
  const [ocrIndexing, setOcrIndexing] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [isOcrCorrecting, setIsOcrCorrecting] = useState(false);
  const [ocrCorrectError, setOcrCorrectError] = useState('');
  const [ocrTab, setOcrTab] = useState('reconstructed'); // 'reconstructed' | 'raw'

  // Session rename states
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editTitleText, setEditTitleText] = useState('');

  // Input message
  const [inputMessage, setInputMessage] = useState('');

  // RAG / Streaming states
  const [streamingContent, setStreamingContent] = useState('');
  const [sidebarCitations, setSidebarCitations] = useState([]);
  const [highlightedCitationId, setHighlightedCitationId] = useState(null);
  const [searchInDocsQuery, setSearchInDocsQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isThinking, setIsThinking] = useState(false);

  const streamingContentRef = useRef('');
  const citationsRef = useRef([]);
  const rightSidebarRef = useRef(null);
  
  const [copiedId, setCopiedId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
  const exportDropdownRef = useRef(null);
  
  useEffect(() => {
    function handleClickOutside(event) {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target)) {
        setIsExportDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const messagesEndRef = useRef(null);

  // Synchronize local selectedDocs state with the active session's selectedDocs property
  useEffect(() => {
    const active = sessions.find(s => s.id === activeSessionId);
    if (active) {
      if (active.selectedDocs !== undefined) {
        setSelectedDocs(active.selectedDocs);
      } else if (documents.length > 0) {
        const docList = documents.map(d => d.filename);
        setSelectedDocs(docList);
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, selectedDocs: docList } : s));
      } else {
        setSelectedDocs([]);
      }
    }
  }, [activeSessionId, documents]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Scroll to bottom on message updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, streamingContent]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0] || { id: 'default', title: 'Study Session', messages: [] };

  // 1. Session Management Actions
  const handleNewSession = () => {
    const docList = documents.map(d => d.filename);
    const newSession = {
      id: Date.now().toString(),
      title: `Study Session ${sessions.length + 1}`,
      messages: [],
      selectedDocs: docList
    };
    setSessions([newSession, ...sessions]);
    setSelectedDocs(docList);
    setActiveSessionId(newSession.id);
  };

  const handleDeleteSession = (id, e) => {
    e.stopPropagation();
    if (sessions.length === 1) {
      alert("You must keep at least one active study session.");
      return;
    }
    const filtered = sessions.filter(s => s.id !== id);
    setSessions(filtered);
    if (activeSessionId === id) {
      setActiveSessionId(filtered[0].id);
    }
  };

  const handleDuplicateSession = (sess, e) => {
    e.stopPropagation();
    const duplicated = {
      id: Date.now().toString(),
      title: `${sess.title} (Copy)`,
      messages: JSON.parse(JSON.stringify(sess.messages)), // deep clone message history
      selectedDocs: sess.selectedDocs ? [...sess.selectedDocs] : documents.map(d => d.filename)
    };
    setSessions([duplicated, ...sessions]);
    setSelectedDocs(duplicated.selectedDocs);
    setActiveSessionId(duplicated.id);
  };

  const handleStartRename = (sess, e) => {
    e.stopPropagation();
    setEditingSessionId(sess.id);
    setEditTitleText(sess.title);
  };

  const handleSaveRename = (id) => {
    if (editTitleText.trim()) {
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title: editTitleText.trim() } : s));
    }
    setEditingSessionId(null);
  };

  const handleKeyDownRename = (e, id) => {
    if (e.key === 'Enter') {
      handleSaveRename(id);
    } else if (e.key === 'Escape') {
      setEditingSessionId(null);
    }
  };

  const updateSelectedDocs = (nextValOrUpdater) => {
    setSelectedDocs(prev => {
      const next = typeof nextValOrUpdater === 'function' ? nextValOrUpdater(prev) : nextValOrUpdater;
      setSessions(sPrev => sPrev.map(s => s.id === activeSessionId ? { ...s, selectedDocs: next } : s));
      return next;
    });
  };

  // 2. Document Selection Handlers
  const toggleDocSelection = (filename) => {
    updateSelectedDocs(prev => 
      prev.includes(filename) 
        ? prev.filter(f => f !== filename) 
        : [...prev, filename]
    );
  };

  const handleSelectAllDocs = () => {
    updateSelectedDocs(documents.map(d => d.filename));
  };

  const handleClearDocsSelection = () => {
    updateSelectedDocs([]);
  };

  // 3. Direct Drag & Drop / File Input Upload Handler
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => 
      f.type === 'application/pdf' || 
      f.type.startsWith('image/') || 
      /\.(pdf|jpg|jpeg|png)$/i.test(f.name)
    );
    if (files.length > 0) {
      await handleFileUpload(files);
    } else {
      setUploadError('Only PDF files and images (.jpg, .jpeg, .png) are supported.');
    }
  };

  const handleFileInputChange = async (e) => {
    const files = Array.from(e.target.files).filter(f => 
      f.type === 'application/pdf' || 
      f.type.startsWith('image/') || 
      /\.(pdf|jpg|jpeg|png)$/i.test(f.name)
    );
    if (files.length > 0) {
      await handleFileUpload(files);
    }
  };

  const handleFileUpload = async (files) => {
    setUploading(true);
    setUploadError('');
    try {
      const response = await uploadFiles(files, 1000, 200, activeSessionId);
      const results = response.results || [];
      
      const newQueue = [];
      const successfullyIndexed = [];
      let uploadErrors = [];

      results.forEach(res => {
        if (res.status === 'ocr_preview_required') {
          newQueue.push(res);
        } else if (res.status === 'success') {
          successfullyIndexed.push(res.filename);
        } else if (res.status === 'error') {
          uploadErrors.push(`${res.filename}: ${res.message}`);
        }
      });

      if (successfullyIndexed.length > 0) {
        const docs = await listDocuments();
        setDocuments(docs);
        updateSelectedDocs(prev => {
          const next = [...prev];
          successfullyIndexed.forEach(name => {
            if (!next.includes(name)) next.push(name);
          });
          return next;
        });
      }

      if (uploadErrors.length > 0) {
        setUploadError(uploadErrors.join('; '));
      }

      if (newQueue.length > 0) {
        setOcrQueue(newQueue);
        setOcrPreviewDoc(newQueue[0]);
        setOcrTab('reconstructed');
      }
    } catch (err) {
      setUploadError(err.message || 'Error indexing documents.');
    } finally {
      setUploading(false);
    }
  };

  const handleOcrApprove = async () => {
    if (!ocrPreviewDoc) return;
    setOcrIndexing(true);
    setOcrError('');
    try {
      // Determine final approved text content to index based on selected tab
      const textToIndex = ocrTab === 'reconstructed' ? (ocrPreviewDoc.corrected_text || ocrPreviewDoc.text) : ocrPreviewDoc.text;
      
      await indexText(
        ocrPreviewDoc.filename, 
        textToIndex,
        ocrPreviewDoc.confidence || 100.0,
        ocrPreviewDoc.reconstruction_confidence || 80.0,
        ocrPreviewDoc.semantic_quality_score || 80.0,
        1000,
        200,
        activeSessionId
      );
      
      const docs = await listDocuments();
      setDocuments(docs);
      
      updateSelectedDocs(prev => {
        if (!prev.includes(ocrPreviewDoc.filename)) {
          return [...prev, ocrPreviewDoc.filename];
        }
        return prev;
      });

      const nextQueue = ocrQueue.slice(1);
      setOcrQueue(nextQueue);
      setOcrTab('reconstructed'); // Reset tab view mode to default
      if (nextQueue.length > 0) {
        setOcrPreviewDoc(nextQueue[0]);
      } else {
        setOcrPreviewDoc(null);
      }
    } catch (err) {
      setOcrError(err.message || 'Failed to index OCR text.');
    } finally {
      setOcrIndexing(false);
    }
  };

  const handleOcrCancel = () => {
    const nextQueue = ocrQueue.slice(1);
    setOcrQueue(nextQueue);
    setOcrTab('reconstructed'); // Reset tab view mode to default
    if (nextQueue.length > 0) {
      setOcrPreviewDoc(nextQueue[0]);
    } else {
      setOcrPreviewDoc(null);
    }
  };

  const handleOcrTextChange = (e) => {
    const val = e.target.value;
    setOcrPreviewDoc(prev => {
      if (ocrTab === 'reconstructed') {
        return { ...prev, corrected_text: val };
      } else {
        return { ...prev, text: val };
      }
    });
  };

  const handleOcrCorrection = async () => {
    if (!ocrPreviewDoc || !ocrPreviewDoc.text) return;
    setIsOcrCorrecting(true);
    setOcrCorrectError('');
    try {
      const data = await correctOcrText(ocrPreviewDoc.text);
      if (data && data.corrected_text) {
        setOcrPreviewDoc(prev => ({
          ...prev,
          corrected_text: data.corrected_text
        }));
        setOcrTab('reconstructed'); // automatically focus reconstructed tab
      }
    } catch (err) {
      setOcrCorrectError(err.message || 'AI Correction failed.');
    } finally {
      setIsOcrCorrecting(false);
    }
  };

  // 4. Sending RAG Chat Stream Request
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    if (documents.length > 0 && selectedDocs.length === 0) {
      alert("Please select at least one document scope checkbox in the sidebar to retrieve facts, or upload a new PDF.");
      return;
    }

    const targetSessionId = activeSession.id;

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputMessage,
      timestamp: getISTTimestamp()
    };

    const historyToSend = [...(activeSession.messages || []), userMessage].map(m => ({
      role: m.role,
      content: m.content
    }));

    setSessions(prev => prev.map(s => s.id === targetSessionId ? { ...s, messages: [...s.messages, userMessage] } : s));
    
    setInputMessage('');
    setStreamingContent('');
    setSidebarCitations([]);
    
    streamingContentRef.current = '';
    citationsRef.current = [];
    setIsThinking(true);

    try {
      const topK = ragSettings?.topK ?? 4;
      const chunkSize = ragSettings?.chunkSize ?? 1000;
      const chunkOverlap = ragSettings?.chunkOverlap ?? 200;

      await streamChat({
        message: userMessage.content,
        docFilter: null,
        docFilters: selectedDocs,
        history: historyToSend,
        explanationMode: explanationMode,
        topK: topK,
        chunkSize: chunkSize,
        chunkOverlap: chunkOverlap,
        knowledgeMode: 'strict_rag',
        responseDepth: responseDepth,
        onChunk: (chunk) => {
          if (!chunk) return;
          setIsThinking(false);
          streamingContentRef.current += chunk;
          setStreamingContent(streamingContentRef.current);
        },
        onReferences: (citations) => {
          // Keep loader active, do NOT set isThinking to false here.
          citationsRef.current = citations || [];
          setSidebarCitations(citations || []);
          if (citations && citations.length > 0) {
            setActiveCitationsTab(true);
          }
        },
        onError: (err) => {
          console.error("Stream error: ", err);
          setIsThinking(false);
          const friendly = err || "The AI engine is temporarily busy. Please retry.";
          appendAssistantMessage(friendly, [], targetSessionId);
          showToast(friendly);
        },
        onDone: () => {
          setIsThinking(false);
          if (streamingContentRef.current.trim()) {
            appendAssistantMessage(streamingContentRef.current, citationsRef.current, targetSessionId);
          }
          setStreamingContent('');
          streamingContentRef.current = '';
        }
      });
    } catch (err) {
      setIsThinking(false);
      const friendly = "Failed to connect to backend server. Please check your network connection.";
      appendAssistantMessage(friendly, [], targetSessionId);
      showToast(friendly);
    }
  };

  const appendAssistantMessage = (content, citations, targetSessionId) => {
    const assistantMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: content,
      citations: citations,
      timestamp: getISTTimestamp()
    };
    const finalSessionId = targetSessionId || activeSession.id;
    setSessions(prev => prev.map(s => s.id === finalSessionId ? { ...s, messages: [...s.messages, assistantMessage] } : s));
  };

  // 5. Scroll-to-source click mapping
  const handleCitationClick = (cite, msgId, cIdx) => {
    setActiveCitationsTab(true);
    setHighlightedCitationId(`${msgId}-${cIdx}`);
    setTimeout(() => {
      const element = document.getElementById(`citation-card-${msgId}-${cIdx}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 200);
  };

  // 6. Direct vector searching inside panel
  const handleDocSearch = async (e) => {
    e.preventDefault();
    if (!searchInDocsQuery.trim()) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: searchInDocsQuery,
          doc_filters: selectedDocs,
          explanation_mode: explanationMode,
          history: [],
          top_k: 8
        })
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const { value } = await reader.read();
      const line = decoder.decode(value);
      const firstLine = line.split('\n')[0];
      const parsed = JSON.parse(firstLine);
      if (parsed.type === 'references') {
        setSearchResults(parsed.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // 7. Utilities
  const copyToClipboard = (text, id) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
      showToast('✅ Copied successfully!');
    } catch (err) {
      console.error('Failed to copy text:', err);
      showToast('❌ Copy failed.');
    }
  };

  const handleExportChat = () => {
    if (!activeSession.messages || activeSession.messages.length === 0) return;
    const formatted = activeSession.messages.map(m => {
      return `### ${m.role === 'user' ? 'Student' : "Yeseswini's AI Study Assistant"} (${m.timestamp})\n\n${m.content}\n\n`;
    }).join('---\n\n');

    const blob = new Blob([formatted], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSession.title.toLowerCase().replace(/\s+/g, '_')}_chat.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportChatPDF = async () => {
    if (!activeSession.messages || activeSession.messages.length === 0) return;
    try {
      showToast('Generating Chat PDF...');
      const chatHistory = activeSession.messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        citations: m.citations ? m.citations.map(c => `[${c.metadata?.source || 'Doc'}, Page ${c.metadata?.page || 1}]`) : []
      }));
      await exportChat(chatHistory, `${activeSession.title} - Chat History - ${getISTTimestamp()}`);
      showToast('✅ Downloaded PDF successfully!');
    } catch (err) {
      console.error(err);
      showToast('❌ Failed to export PDF.');
    }
  };

  const handleExportNotesPDF = async () => {
    if (!notesContent || notesContent.trim() === '') {
      showToast('⚠ No notes content to export.');
      return;
    }
    try {
      showToast('Generating Notes PDF...');
      await exportNotes(notesContent, `${activeSession.title} - Notes - ${getISTTimestamp()}`);
      showToast('✅ Downloaded Notes PDF successfully!');
    } catch (err) {
      console.error(err);
      showToast('❌ Failed to export Notes PDF.');
    }
  };

  const handleExportEntireSessionPDF = async () => {
    if (!activeSession.messages || activeSession.messages.length === 0) {
      showToast('⚠ No chat messages to export.');
      return;
    }
    try {
      showToast('Generating Combined PDF...');
      const chatMD = activeSession.messages.map(m => {
        const citationsText = m.citations && m.citations.length > 0 
          ? `\n\n**Sources & Citations:**\n` + m.citations.map(c => `* [${c.metadata?.source || 'Doc'}, Page ${c.metadata?.page || 1}]`).join('\n')
          : '';
        return `### ${m.role === 'user' ? 'Student' : "Yeseswini's AI Study Assistant"} (${m.timestamp || ''})\n\n${m.content}${citationsText}\n\n`;
      }).join('---\n\n');
      
      const combinedMarkdown = `# Study Session: ${activeSession.title}\n\n` +
        `## 1. Chat Conversation Log\n\n${chatMD}\n\n` +
        `---\n\n` +
        `## 2. Generated Study Notes Workspace\n\n${notesContent}`;
        
      await exportNotes(combinedMarkdown, `${activeSession.title} - Full Session`);
      showToast('✅ Downloaded Combined PDF successfully!');
    } catch (err) {
      console.error(err);
      showToast('❌ Failed to export Entire Session.');
    }
  };

  const MarkdownRenderer = ({ text }) => {
    const processedText = preprocessMarkdown(text);
    return (
      <div className="markdown-body leading-relaxed text-slate-100 text-xs sm:text-sm">
        <ReactMarkdown 
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {processedText}
        </ReactMarkdown>
      </div>
    );
  };

  // Internal component for collapsible citation cards
  const CitationCard = ({ cite, cardId, isHighlighted }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    return (
      <div 
        id={cardId}
        className={`bg-slate-950/50 border rounded-xl p-3.5 text-[10px] leading-relaxed shadow-sm transition-all duration-300 ${
          isHighlighted 
            ? 'border-gold bg-gold/10 ring-1 ring-gold/40' 
            : 'border-white/5 hover:border-gold/20'
        }`}
      >
        <div className="flex justify-between items-center mb-2 text-[8px] text-gold-light/60 font-bold border-b border-white/5 pb-1.5">
          <span className="truncate max-w-[120px]">{cite.metadata.source || 'Doc'} (Page {cite.metadata.page || 1})</span>
          <span className="text-gold bg-gold/10 px-1.5 py-0.2 rounded font-mono border border-gold/20">Score: {cite.score?.toFixed(3) || '0.0'}</span>
        </div>
        <p className="text-slate-300 italic">
          "{isExpanded ? cite.content : `${cite.content.substring(0, 150)}${cite.content.length > 150 ? '...' : ''}`}"
        </p>
        {cite.content.length > 150 && (
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-[9px] text-gold hover:underline mt-1.5 font-bold flex items-center gap-0.5"
          >
            {isExpanded ? (
              <>
                <span>Show Less</span>
                <ChevronUp className="w-3 h-3" />
              </>
            ) : (
              <>
                <span>Show More</span>
                <ChevronDown className="w-3 h-3" />
              </>
            )}
          </button>
        )}
      </div>
    );
  };

  return (
    <div 
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="flex-1 flex overflow-hidden h-full relative z-10"
    >
      {/* Full-window Drag & Drop Overlay */}
      {isDragging && (
        <div 
          onDragLeave={handleDragLeave}
          className="absolute inset-0 bg-navy-950/80 backdrop-blur-md border-2 border-dashed border-gold flex flex-col items-center justify-center text-center p-6 z-50 transition-all duration-300 animate-fade-in"
        >
          <div className="p-6 rounded-full bg-gold/10 border border-gold/30 mb-4 animate-bounce">
            <UploadCloud className="w-12 h-12 text-gold" />
          </div>
          <h2 className="text-xl font-academic font-bold text-gold-light">Drop Study PDF or Image Here</h2>
          <p className="text-xs text-slate-400 mt-2">Release the mouse button to upload and start studying.</p>
        </div>
      )}
      
      {/* Backdrop overlay for left sidebar on mobile */}
      {isLeftSidebarOpen && (
        <div 
          onClick={() => setIsLeftSidebarOpen(false)}
          className="md:hidden fixed inset-0 bg-black/60 z-30 backdrop-blur-sm transition-opacity duration-300"
        />
      )}

      {/* Left Sidebar (Sessions List & PDF multi-select scope) */}
      <div className={`flex flex-col justify-between select-none transition-all duration-300 border-white/5
        fixed inset-y-0 left-0 z-40 bg-slate-950 shadow-2xl h-full border-r
        md:relative md:inset-auto md:bg-slate-950/45 md:shadow-none md:h-full md:border-r
        ${isLeftSidebarOpen 
          ? 'w-64 p-4 translate-x-0' 
          : 'w-0 overflow-hidden p-0 border-r-0 -translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex-1 flex flex-col min-h-0 space-y-6">
          {/* Active Sessions list block */}
          <div className="flex flex-col min-h-[40%] max-h-[50%]">
            <button
              onClick={handleNewSession}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-gold-dark/25 to-gold/15 border border-gold/30 text-gold-light hover:from-gold-dark hover:to-gold hover:text-navy-950 text-xs font-bold transition-all duration-300 shadow-md flex-shrink-0 mb-4"
            >
              <Plus className="w-4 h-4" />
              <span>New Session</span>
            </button>

            <div className="flex-1 overflow-y-auto pr-1">
              <h4 className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-3 px-1">Study Sessions</h4>
              <div className="space-y-1.5">
                {sessions.map((sess) => {
                  const isEditing = editingSessionId === sess.id;
                  const isActive = sess.id === activeSessionId;
                  return (
                    <div
                      key={sess.id}
                      onClick={() => !isEditing && setActiveSessionId(sess.id)}
                      className={`group flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-all duration-200 text-xs border ${
                        isActive
                          ? 'bg-white/5 border-white/10 text-gold-light font-semibold'
                          : 'hover:bg-white/5 border-transparent text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 overflow-hidden flex-1">
                        <BookOpen className="w-3.5 h-3.5 text-gold/60 group-hover:text-gold flex-shrink-0" />
                        {isEditing ? (
                          <input
                            type="text"
                            value={editTitleText}
                            onChange={(e) => setEditTitleText(e.target.value)}
                            onBlur={() => handleSaveRename(sess.id)}
                            onKeyDown={(e) => handleKeyDownRename(e, sess.id)}
                            className="bg-slate-900 border border-gold/40 text-slate-100 px-1.5 py-0.5 rounded text-xs w-full focus:outline-none"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className="truncate">{sess.title}</span>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all ml-1">
                          <button
                            onClick={(e) => handleStartRename(sess, e)}
                            className="p-1 hover:bg-white/5 rounded text-slate-400 hover:text-gold"
                            title="Rename"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => handleDuplicateSession(sess, e)}
                            className="p-1 hover:bg-white/5 rounded text-slate-400 hover:text-gold"
                            title="Duplicate"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteSession(sess.id, e)}
                            className="p-1 hover:bg-rose-950/30 rounded text-slate-400 hover:text-rose-400"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RAG Selectable Document Dropdown Section */}
          <div className="flex-shrink-0 border-t border-white/5 pt-4 mb-3">
            <div className="relative mb-2" ref={dropdownRef}>
              <div className="flex justify-between items-center mb-2 px-1">
                <h4 className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Document Scope</h4>
                <span className="text-[9px] text-gold font-bold">({selectedDocs.length} selected)</span>
              </div>
              
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="custom-dropdown-trigger"
              >
                <span className="truncate text-slate-300 font-medium">
                  {selectedDocs.length === 0 
                    ? 'Select study PDFs...' 
                    : selectedDocs.length === 1 
                      ? selectedDocs[0] 
                      : selectedDocs.length === documents.length 
                        ? 'All PDFs selected' 
                        : `${selectedDocs.length} PDFs selected`}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              </button>
              
              {isDropdownOpen && (
                <div className="custom-dropdown-menu animate-fadeIn">
                  {/* Search Header */}
                  <div className="dropdown-search-container">
                    <Search className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <input
                      type="text"
                      placeholder="Search PDFs..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="dropdown-search-input"
                    />
                    {searchTerm && (
                      <button type="button" onClick={() => setSearchTerm('')} className="text-slate-500 hover:text-white flex-shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="dropdown-actions">
                    <button 
                      type="button"
                      onClick={handleSelectAllDocs}
                      className="text-gold hover:text-gold-light transition"
                    >
                      Select All
                    </button>
                    <button 
                      type="button"
                      onClick={handleClearDocsSelection}
                      className="text-slate-400 hover:text-white transition"
                    >
                      Clear Selection
                    </button>
                  </div>

                  {/* Document List */}
                  <div className="overflow-y-auto max-h-48 divide-y divide-white/5">
                    {documents.filter(doc => doc.filename.toLowerCase().includes(searchTerm.toLowerCase())).length > 0 ? (
                      documents.filter(doc => doc.filename.toLowerCase().includes(searchTerm.toLowerCase())).map((doc, idx) => {
                        const isSelected = selectedDocs.includes(doc.filename);
                        return (
                          <div
                            key={idx}
                            onClick={() => toggleDocSelection(doc.filename)}
                            className={`dropdown-row ${isSelected ? 'selected' : 'unselected'}`}
                          >
                            <div className={`dropdown-checkbox-box ${isSelected ? 'selected' : ''}`}>
                              {isSelected && <Check className="w-2.5 h-2.5 stroke-[3px]" />}
                            </div>
                            <div className="overflow-hidden leading-tight flex-1">
                              <p className="truncate" title={doc.filename}>{doc.filename}</p>
                              <p className="text-[9px] text-slate-500 mt-0.5">{doc.pages} pgs • {((doc.size_bytes || 0) / 1024).toFixed(0)} KB</p>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-4 text-center text-xs text-slate-500 italic">
                        No documents found
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

            {/* Direct Uploader Mini Drag Box */}
            <div 
              onClick={() => fileInputRef.current.click()}
              className="border border-dashed border-white/10 hover:border-gold/30 hover:bg-white/5 rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer transition-all flex-shrink-0 bg-slate-950/20"
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
                  <span className="text-[10px] text-slate-300 font-medium">Processing file...</span>
                </div>
              ) : (
                <>
                  <UploadCloud className="w-6 h-6 text-gold mb-1" />
                  <span className="text-[9px] text-slate-300 font-semibold">Upload PDF / Image</span>
                  <span className="text-[8px] text-slate-500 mt-0.5">Click or drag & drop</span>
                </>
              )}
            </div>
            {uploadError && <p className="text-[9px] text-rose-400 mt-1.5 bg-rose-950/20 border border-rose-500/20 px-2.5 py-1 rounded-lg truncate">{uploadError}</p>}

        </div>
      </div>

      {/* RAG Chat Window Center */}
      <div className="flex-1 flex flex-col justify-between overflow-hidden bg-slate-900/10">
        
        {/* Top Controls Header Bar */}
        <div className="glass-panel border-b border-white/5 px-5 py-2.5 flex justify-between items-center z-10 shadow-md">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
              className="p-2 rounded-xl bg-slate-950/40 border border-white/5 text-slate-400 hover:text-gold hover:border-gold/30 transition-all duration-200"
              title="Toggle left panel"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-gold" />
              <h3 className="text-sm font-semibold tracking-wide text-gold-light">{activeSession.title}</h3>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Response Depth Switch */}
            <div className="flex bg-slate-950/50 p-1 rounded-xl border border-white/5 select-none">
              {[
                { id: 'concise', label: 'Concise' },
                { id: 'standard', label: 'Standard' },
                { id: 'detailed', label: 'Detailed' }
              ].map((depth) => {
                const isActive = responseDepth === depth.id;
                let activeClass = '';
                if (isActive) {
                  activeClass = 'bg-gold/10 text-gold-light font-extrabold border-gold/30';
                }
                return (
                  <button
                    key={depth.id}
                    onClick={() => setResponseDepth(depth.id)}
                    className={`px-2.5 py-1 rounded-lg text-[9px] uppercase font-bold tracking-wider transition-all duration-300 border border-transparent ${
                      isActive
                        ? `${activeClass} shadow`
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {depth.label}
                  </button>
                );
              })}
            </div>

            {/* Export Options Dropdown */}
            <div className="relative" ref={exportDropdownRef}>
              <button
                onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                className={`p-2 rounded-xl border transition-all duration-200 ${
                  isExportDropdownOpen
                    ? 'bg-gold/10 border-gold/40 text-gold'
                    : 'bg-slate-950/40 border-white/5 text-slate-400 hover:text-gold hover:border-gold/30'
                }`}
                title="Export options"
              >
                <Download className="w-4 h-4" />
              </button>

              {isExportDropdownOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-xl bg-slate-950/95 backdrop-blur-md border border-white/10 shadow-2xl z-50 p-1.5 flex flex-col gap-0.5 animate-fadeIn">
                  <div className="px-2.5 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                    Export Options
                  </div>
                  
                  <button
                    onClick={() => {
                      handleExportChatPDF();
                      setIsExportDropdownOpen(false);
                    }}
                    className="flex items-center justify-between text-left w-full px-2.5 py-2 rounded-lg text-xs font-semibold text-slate-200 hover:bg-gold/10 hover:text-gold transition-all"
                  >
                    <span className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-gold" />
                      <span>Export as PDF</span>
                    </span>
                    <span className="text-[8px] bg-gold/10 text-gold px-1.5 py-0.5 rounded font-extrabold tracking-wide uppercase">Default</span>
                  </button>

                  <button
                    onClick={() => {
                      handleExportChat();
                      setIsExportDropdownOpen(false);
                    }}
                    className="flex items-center gap-2 text-left w-full px-2.5 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-white/5 hover:text-white transition-all"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                    <span>Export as Markdown</span>
                  </button>

                  <button
                    onClick={() => {
                      handleExportNotesPDF();
                      setIsExportDropdownOpen(false);
                    }}
                    className="flex items-center gap-2 text-left w-full px-2.5 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-white/5 hover:text-white transition-all"
                  >
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                    <span>Export Notes Only</span>
                  </button>

                  <button
                    onClick={() => {
                      handleExportEntireSessionPDF();
                      setIsExportDropdownOpen(false);
                    }}
                    className="flex items-center gap-2 text-left w-full px-2.5 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-white/5 hover:text-white transition-all"
                  >
                    <Layers className="w-3.5 h-3.5 text-slate-400" />
                    <span>Export Entire Session</span>
                  </button>
                </div>
              )}
            </div>

            {/* Citations toggle */}
            <button
              onClick={() => setActiveCitationsTab(!activeCitationsTab)}
              className={`p-2 rounded-xl border transition-all duration-200 ${
                activeCitationsTab
                  ? 'bg-gold/10 border-gold/40 text-gold'
                  : 'bg-slate-950/40 border-white/5 text-slate-400 hover:text-gold'
              }`}
              title="Toggle citations tab"
            >
              <PanelRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Message Container Thread */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
          {(!activeSession.messages || activeSession.messages.length === 0) && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto py-6">
              <div className="p-4 rounded-full bg-gold/5 border border-gold/15 animate-float shadow-inner mb-1">
                <Sparkles className="w-8 h-8 text-gold" />
              </div>
              <div className="space-y-2">
                <h4 className="font-academic text-base font-bold text-gold-light">Academic Study Assistant</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Select your study materials from the scope in the left panel, type a question, and I'll generate grounded answers drawing context directly from your documents.
                </p>
              </div>
            </div>
          )}

          {activeSession.messages && activeSession.messages.map((msg) => (
            <div key={msg.id} className={`flex items-start gap-3.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`p-2 rounded-xl flex-shrink-0 border shadow ${
                msg.role === 'user'
                  ? 'bg-gold/10 border-gold/30 text-gold'
                  : 'bg-slate-950/50 border-white/5 text-slate-300'
              }`}>
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
              </div>

              <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-5 py-4 relative border flex flex-col justify-between shadow-md ${
                msg.role === 'user'
                  ? 'bg-gradient-to-br from-gold-dark/20 to-gold/5 border-gold/30 text-slate-100 rounded-tr-none'
                  : 'glass-card border-white/5 rounded-tl-none'
              }`}>
                <MarkdownRenderer text={msg.content} />

                {/* Citation badging */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-white/5 flex flex-wrap gap-2">
                    {msg.citations.map((cite, cIdx) => (
                      <span
                        key={cIdx}
                        onClick={() => handleCitationClick(cite, msg.id, cIdx)}
                        className={`text-[9px] font-bold text-gold bg-gold/10 hover:bg-gold/20 px-2.5 py-0.5 rounded-full border border-gold/20 cursor-pointer transition-colors ${
                          highlightedCitationId === `${msg.id}-${cIdx}` ? 'ring-1 ring-gold bg-gold/20' : ''
                        }`}
                        title={cite.content}
                      >
                        [{cite.metadata?.source || 'Doc'}, Page {cite.metadata?.page || 1}]
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex justify-between items-center mt-3 pt-2.5 border-t border-white/5 text-[9px] text-slate-500">
                  <span>{msg.timestamp}</span>
                  <button
                    onClick={() => copyToClipboard(msg.content, msg.id)}
                    className="hover:text-gold transition-colors flex items-center gap-1"
                  >
                    {copiedId === msg.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedId === msg.id ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Thinking Spinner */}
          {isThinking && (
            <div className="flex items-start gap-3.5">
              <div className="p-2 rounded-xl bg-slate-950/50 border border-white/5 text-slate-300 flex-shrink-0">
                <Sparkles className="w-4 h-4 text-gold animate-spin" />
              </div>
              <div className="max-w-[80%] sm:max-w-[75%] glass-card rounded-2xl rounded-tl-none px-5 py-4 border border-white/5 shadow-md flex items-center gap-3">
                <div className="flex space-x-1.5 items-center py-2 px-1">
                  <div className="w-1.5 h-1.5 bg-gold rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-1.5 h-1.5 bg-gold rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-1.5 h-1.5 bg-gold rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
                <span className="text-[11px] text-slate-400 font-medium italic">Retrieving study resources...</span>
              </div>
            </div>
          )}

          {/* Live streaming bubble */}
          {streamingContent && (
            <div className="flex items-start gap-3.5">
              <div className="p-2 rounded-xl bg-slate-950/50 border border-white/5 text-slate-300 flex-shrink-0">
                <Sparkles className="w-4 h-4 text-gold animate-spin" />
              </div>
              <div className="max-w-[85%] sm:max-w-[75%] glass-card rounded-2xl rounded-tl-none px-5 py-4 border border-white/5 shadow-md">
                <MarkdownRenderer text={streamingContent} />
                <span className="typing-cursor ml-1 text-gold font-bold"></span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Box Footer */}
        <div className="p-4 border-t border-white/5 bg-slate-950/20 backdrop-blur-md flex flex-col gap-2">
          {/* Active retrieval scope banner */}
          <div className="flex items-center gap-1.5 max-w-4xl mx-auto w-full text-[11px] font-medium text-slate-400 select-none border-b border-white/5 pb-2 mb-1">
            <span className={`w-1.5 h-1.5 rounded-full ${selectedDocs.length > 0 ? 'bg-gold animate-pulse' : 'bg-rose-500 animate-pulse'}`}></span>
            <span>
              {selectedDocs.length === 0
                ? "No documents selected. Please select a document to start studying."
                : selectedDocs.length === 1
                  ? `Searching: ${selectedDocs[0]}`
                  : selectedDocs.length === documents.length
                    ? "Searching all uploaded materials"
                    : `Searching: ${selectedDocs.length} selected documents`}
            </span>
          </div>

          {selectedDocs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center max-w-4xl mx-auto w-full select-none animate-fadeIn">
              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mr-1">Selected:</span>
              {selectedDocs.map((doc, idx) => (
                <div 
                  key={idx}
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-gold/10 border border-gold/20 text-gold-light text-[9px] font-medium max-w-[180px]"
                >
                  <span className="truncate">{doc}</span>
                  <button 
                    type="button" 
                    onClick={() => updateSelectedDocs(prev => prev.filter(f => f !== doc))}
                    className="hover:text-white text-gold/60 transition flex-shrink-0"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleSendMessage} className="flex gap-2 max-w-4xl mx-auto w-full">
            <input
              type="text"
              placeholder={
                selectedDocs.length > 0
                  ? `Ask about ${selectedDocs.length} selected study files...`
                  : "Select one or more PDF files to ask questions..."
              }
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              className="glass-input flex-1 px-4 py-3 text-xs sm:text-sm rounded-xl focus:border-gold/40 shadow-inner"
            />
            <button
              type="submit"
              disabled={selectedDocs.length === 0}
              className="p-3 rounded-xl bg-gradient-to-r from-gold-dark to-gold text-navy-950 font-bold shadow-lg hover:opacity-90 hover:scale-105 active:scale-95 transition-all duration-150 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              <Send className="w-4 h-4 fill-navy-950 stroke-[2.5px]" />
            </button>
          </form>
        </div>

      </div>

      {/* Backdrop overlay for right sidebar on mobile */}
      {activeCitationsTab && (
        <div 
          onClick={() => setActiveCitationsTab(false)}
          className="md:hidden fixed inset-0 bg-black/60 z-30 backdrop-blur-sm transition-opacity duration-300"
        />
      )}

      {/* RAG Citations Panel (Right Sidebar) */}
      <div 
        ref={rightSidebarRef}
        className={`flex flex-col justify-between overflow-y-auto transition-all duration-300 border-l border-white/5
          fixed inset-y-0 right-0 z-40 bg-slate-950 shadow-2xl h-full
          md:relative md:inset-auto md:bg-slate-950/45 md:shadow-none md:h-full
          ${activeCitationsTab 
            ? 'w-80 p-4 translate-x-0' 
            : 'w-0 overflow-hidden p-0 border-l-0 translate-x-full md:translate-x-0'
          }`}
      >
        <div className="min-w-[288px]">
          <div className="flex justify-between items-center mb-5 pb-2.5 border-b border-white/5">
            <h4 className="text-xs font-academic font-bold text-gold-light flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-gold" />
              Citations & References
            </h4>
            <button onClick={() => setActiveCitationsTab(false)} className="text-[10px] text-slate-500 hover:text-white transition-colors">Close</button>
          </div>

          {/* Keyword Search in collection */}
          <form onSubmit={handleDocSearch} className="mb-5 bg-slate-900/35 border border-white/5 p-3 rounded-xl">
            <label className="block text-[9px] uppercase font-bold text-slate-500 mb-1.5">Keyword Search in Materials</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="Find matches..."
                value={searchInDocsQuery}
                onChange={(e) => setSearchInDocsQuery(e.target.value)}
                className="glass-input flex-1 px-3 py-1.5 text-[10px] rounded-lg"
              />
              <button type="submit" className="px-3 py-1.5 rounded-lg bg-gold text-navy-950 hover:bg-gold/90 text-[10px] font-bold transition-all flex-shrink-0">Search</button>
            </div>
          </form>

          <div className="space-y-3">
            <h5 className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">
              {searchResults.length > 0 ? 'Search matches' : 'Reference Passages'}
            </h5>
            
            {(searchResults.length > 0 ? searchResults : sidebarCitations).map((cite, idx) => {
              // Construct a matching card ID to allow scroll-to-source targeting
              const isSelectedMsgCard = sessions.some(s => s.id === activeSessionId && s.messages.some(m => m.citations && m.citations.some((c, cIdx) => {
                const isHighlight = highlightedCitationId === `${m.id}-${cIdx}` && c.content === cite.content;
                return isHighlight;
              })));

              const cardId = sessions.reduce((found, s) => {
                if (found) return found;
                if (s.id !== activeSessionId) return found;
                s.messages.forEach(m => {
                  if (m.citations) {
                    m.citations.forEach((c, cIdx) => {
                      if (c.content === cite.content) {
                        found = `citation-card-${m.id}-${cIdx}`;
                      }
                    });
                  }
                });
                return found;
              }, null) || `general-card-${idx}`;

              return (
                <CitationCard 
                  key={idx} 
                  cite={cite} 
                  cardId={cardId}
                  isHighlighted={highlightedCitationId && cardId.endsWith(highlightedCitationId)} 
                />
              );
            })}

            {(searchResults.length === 0 && sidebarCitations.length === 0) && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <FileText className="w-8 h-8 text-slate-700 mb-2" />
                <p className="text-[10px] text-slate-500 italic">Chat or query keywords to inspect source context blocks.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* OCR Preview Drawer/Modal Overlay */}
      {ocrPreviewDoc && (() => {
        const conf = ocrPreviewDoc.confidence || 0;
        let quality = 'Poor';
        let qualityColor = 'bg-rose-950/20 text-rose-400 border-rose-500/20';
        if (conf >= 90) {
          quality = 'Excellent';
          qualityColor = 'bg-gold/10 text-gold-light border-gold/30';
        } else if (conf >= 80) {
          quality = 'Good';
          qualityColor = 'bg-gold/5 text-gold/80 border-gold/20';
        } else if (conf >= 70) {
          quality = 'Moderate';
          qualityColor = 'bg-slate-900 text-slate-300 border-white/10';
        }

        return (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-scale-up">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between bg-slate-950/40 gap-3">
                <div>
                  <h3 className="text-sm font-academic font-bold text-gold-light flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-gold animate-pulse" />
                    OCR Text Extraction & Preview
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1 truncate max-w-md">
                    File: <span className="font-semibold text-slate-300">{ocrPreviewDoc.filename}</span> ({((ocrPreviewDoc.size_bytes || 0) / 1024).toFixed(0)} KB • {ocrPreviewDoc.pages} {ocrPreviewDoc.pages === 1 ? 'page' : 'pages'})
                  </p>
                </div>
                
                <div className="flex items-center gap-2 flex-wrap">
                  {/* OCR Confidence Badge */}
                  <div className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${qualityColor}`}>
                    OCR Quality: {quality} ({conf.toFixed(1)}%)
                  </div>

                  {/* Reconstruction Confidence Badge */}
                  {ocrPreviewDoc.reconstruction_confidence !== undefined && (
                    <div className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border
                      ${ocrPreviewDoc.reconstruction_confidence >= 70 
                        ? 'bg-gold/10 text-gold-light border-gold/30' 
                        : 'bg-slate-900 text-slate-400 border-white/5'
                      }`}
                    >
                      AI Reconstruction: {ocrPreviewDoc.reconstruction_confidence}%
                    </div>
                  )}

                  {/* Semantic Quality Badge */}
                  {ocrPreviewDoc.semantic_quality_score !== undefined && (
                    <div className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border
                      ${ocrPreviewDoc.semantic_quality_score >= 75 
                        ? 'bg-gold/10 text-gold-light border-gold/30' 
                        : 'bg-slate-900 text-slate-400 border-white/5'
                      }`}
                    >
                      Semantic Quality: {ocrPreviewDoc.semantic_quality_score >= 75 ? 'High' : 'Medium'} ({ocrPreviewDoc.semantic_quality_score}%)
                    </div>
                  )}
                </div>
              </div>

              {/* Warning Message for low quality */}
              {conf < 70 && (
                <div className="mx-6 mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2.5 animate-pulse">
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div className="text-[10.5px] leading-relaxed text-amber-300">
                    <span className="font-bold">Low Confidence Recommendation:</span> OCR quality is rated as <span className="underline font-bold">Poor</span>. We highly recommend retaking the photo or re-uploading a clearer document. You can also click the <span className="text-gold font-semibold">"Auto-repair with AI"</span> button below to have the LLM reconstruct spelling/grammar mistakes automatically.
                  </div>
                </div>
              )}

              {/* Editable Textbox Body */}
              <div className="flex-1 p-6 overflow-y-auto flex flex-col gap-2 min-h-0">
                <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setOcrTab('reconstructed')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        ocrTab === 'reconstructed'
                          ? 'bg-gold text-navy-950 shadow-md'
                          : 'bg-white/5 text-slate-400 hover:bg-white/10'
                      }`}
                    >
                      AI Cleaned Notes
                    </button>
                    <button
                      onClick={() => setOcrTab('raw')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        ocrTab === 'raw'
                          ? 'bg-gold text-navy-950 shadow-md'
                          : 'bg-white/5 text-slate-400 hover:bg-white/10'
                      }`}
                    >
                      Original OCR (Raw)
                    </button>
                  </div>
                  
                  <button
                    onClick={handleOcrCorrection}
                    disabled={isOcrCorrecting || !ocrPreviewDoc.text}
                    className="px-3 py-1.5 rounded-lg bg-gold/10 text-gold border border-gold/20 text-[10px] font-bold flex items-center gap-1.5 hover:bg-gold/25 transition-all disabled:opacity-50"
                  >
                    {isOcrCorrecting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        AI Repairing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Auto-repair with AI
                      </>
                    )}
                  </button>
                </div>

                {ocrCorrectError && (
                  <p className="text-[10px] text-rose-400 bg-rose-950/20 border border-rose-500/20 px-3 py-1.5 rounded-lg">
                    AI Repair Error: {ocrCorrectError}
                  </p>
                )}
                
                <textarea
                  value={ocrTab === 'reconstructed' ? (ocrPreviewDoc.corrected_text || ocrPreviewDoc.text || '') : (ocrPreviewDoc.text || '')}
                  onChange={handleOcrTextChange}
                  placeholder={ocrTab === 'reconstructed' ? "AI cleaned notes view..." : "Raw OCR text view..."}
                  className="w-full flex-1 bg-slate-950/45 border border-white/5 focus:border-gold/30 rounded-xl p-4 text-xs font-mono text-slate-300 leading-relaxed outline-none resize-none shadow-inner min-h-[300px]"
                />
              </div>

              {/* Modal Actions Footer */}
              <div className="px-6 py-4 border-t border-white/5 bg-slate-950/40 flex justify-between items-center">
                <div className="flex flex-col">
                  {ocrIndexing ? (
                    <span className="text-[10px] text-teal-400 animate-pulse font-semibold">Analyzing and indexing document...</span>
                  ) : ocrError ? (
                    <span className="text-[10px] text-rose-400 max-w-sm truncate font-semibold">Error: {ocrError}</span>
                  ) : (
                    <span className="text-[10px] text-slate-500">Ready to save to study library.</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleOcrCancel}
                    disabled={ocrIndexing}
                    className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 text-xs font-bold transition-all disabled:opacity-50"
                  >
                    Discard / Skip
                  </button>
                  <button
                    onClick={handleOcrApprove}
                    disabled={ocrIndexing || isOcrCorrecting}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-gold-dark to-gold text-navy-950 font-bold text-xs shadow-lg hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {ocrIndexing ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Indexing...
                      </>
                    ) : (
                      <>
                        <CheckSquare className="w-3.5 h-3.5" />
                        Approve & Index
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {toastMessage && (() => {
        const { text, isError } = parseToastMessage(toastMessage);
        return (
          <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl border shadow-2xl transition-all duration-300 font-semibold text-xs sm:text-sm animate-slideInRight max-w-sm pointer-events-auto bg-slate-950 text-slate-100 ${
            isError ? 'border-rose-500/40 text-rose-200' : 'border-gold/30 text-slate-100'
          }`}>
            {isError ? (
              <span className="text-rose-400 text-base" aria-hidden="true">⚠</span>
            ) : (
              <span className="text-emerald-400 text-base" aria-hidden="true">✅</span>
            )}
            <span className="leading-tight">{text}</span>
          </div>
        );
      })()}

    </div>
  );
}
