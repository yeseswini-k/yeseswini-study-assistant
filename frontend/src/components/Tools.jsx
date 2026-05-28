import React, { useState, useRef, useEffect } from 'react';
import { BookOpen, Sparkles, HelpCircle, FileText, CheckCircle2, ChevronLeft, ChevronRight, Download, Edit3, Loader2, Award, ClipboardList, PenTool, ChevronDown, Search, X, Check, Maximize2, Minimize2, Copy, Printer, UploadCloud } from 'lucide-react';
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

// Inline Markdown Renderer for smaller blocks (like options and card faces)
const InlineMarkdownRenderer = ({ text }) => {
  const processedText = preprocessMarkdown(text);
  return (
    <span className="markdown-body leading-relaxed text-xs sm:text-sm inline-block">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({node, children, ...props}) => <span {...props}>{children}</span>
        }}
      >
        {processedText}
      </ReactMarkdown>
    </span>
  );
};
import { 
  generateSummary, 
  generateFlashcards, 
  generateQuiz, 
  generateQuestions, 
  extractFormulas, 
  extractDefinitions,
  exportNotes,
  streamNotes,
  uploadFiles,
  listDocuments,
  validateLimit
} from '../utils/api';

// Helper to determine CTA label contextually
const getCtaLabel = (tool, hasGenerated = false) => {
  const prefix = hasGenerated ? 'Regenerate' : 'Generate';
  switch (tool) {
    case 'summary': return `${prefix} Summary`;
    case 'flashcards': return `${prefix} Flashcards`;
    case 'quiz': return `${prefix} Quiz`;
    case 'questions': return `${prefix} Key Questions`;
    case 'formulas': return `${prefix} Formula Sheet`;
    case 'definitions': return `${prefix} Glossary`;
    case 'notes': return `${prefix} Study Notes`;
    default: return `${prefix} Content`;
  }
};

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

export default function Tools({ 
  documents, 
  setDocuments,
  explanationMode, 
  notesContent, 
  setNotesContent, 
  responseDepth, 
  setResponseDepth 
}) {
  const [selectedDocs, setSelectedDocs] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

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

  const getDropdownLabel = () => {
    if (selectedDocs.length === 0) return 'Select study files...';
    if (selectedDocs.length === 1) return selectedDocs[0];
    if (selectedDocs.length === documents.length) return 'All documents selected';
    return `${selectedDocs.length} files selected`;
  };

  const toggleDoc = (filename) => {
    setSelectedDocs(prev => 
      prev.includes(filename) 
        ? prev.filter(f => f !== filename) 
        : [...prev, filename]
    );
  };

  const filteredDocs = documents.filter(doc => 
    doc.filename.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const [activeTool, setActiveTool] = useState('summary'); // summary, flashcards, quiz, questions, formulas, definitions, notes
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Data stores
  const [summaryData, setSummaryData] = useState('');
  const [flashcards, setFlashcards] = useState([]);
  const [flashcardsSourceIndicator, setFlashcardsSourceIndicator] = useState('');
  const [activeCardIdx, setActiveCardIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [flashcardCount, setFlashcardCount] = useState(10);

  // Quiz states
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [quizSourceIndicator, setQuizSourceIndicator] = useState('');
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizCount, setQuizCount] = useState(5);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);

  // General text stores
  const [importantQuestions, setImportantQuestions] = useState('');
  const [extractedFormulas, setExtractedFormulas] = useState('');
  const [extractedDefinitions, setExtractedDefinitions] = useState('');
  const [notesMode, setNotesMode] = useState('preview'); // preview, edit
  const [isFullscreenNotes, setIsFullscreenNotes] = useState(false);
  const [notesSearchQuery, setNotesSearchQuery] = useState('');
  const [copiedNotes, setCopiedNotes] = useState(false);
  const [notesGenMode, setNotesGenMode] = useState('detailed'); // quick, detailed, deep
  const [toastMessage, setToastMessage] = useState(null);

  const hasGeneratedData = (() => {
    switch (activeTool) {
      case 'summary': return !!summaryData;
      case 'flashcards': return flashcards.length > 0;
      case 'quiz': return quizQuestions.length > 0;
      case 'questions': return !!importantQuestions;
      case 'formulas': return !!extractedFormulas;
      case 'definitions': return !!extractedDefinitions;
      case 'notes': return !!notesContent && notesContent.trim().length > 0;
      default: return false;
    }
  })();
  
  // File upload states & handlers
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
        if (res.status === 'success') {
          successfullyIndexed.push(res.filename);
        } else if (res.status === 'error') {
          uploadErrors.push(`${res.filename}: ${res.message}`);
        } else if (res.status === 'ocr_preview_required') {
          successfullyIndexed.push(res.filename);
        }
      });

      if (successfullyIndexed.length > 0) {
        const docs = await listDocuments();
        if (setDocuments) setDocuments(docs);
        setSelectedDocs(prev => {
          const next = [...prev];
          successfullyIndexed.forEach(name => {
            if (!next.includes(name)) next.push(name);
          });
          return next;
        });
        showToast("✅ Documents indexed successfully!");
      }

      if (uploadErrors.length > 0) {
        setUploadError(uploadErrors.join('; '));
        showToast("⚠ Some uploads failed.");
      }
    } catch (err) {
      setUploadError(err.message || 'Error indexing documents.');
      showToast("⚠ Error uploading files.");
    } finally {
      setUploading(false);
    }
  };
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleCopyContent = (text, name) => {
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
      showToast(`✅ ${name} copied successfully!`);
    } catch (err) {
      console.error('Failed to copy text:', err);
      showToast('⚠ Copy failed.');
    }
  };

  const handleExportPDFContent = async (markdownText, title) => {
    try {
      showToast('Generating PDF...');
      await exportNotes(markdownText, title);
      showToast('✅ Downloaded PDF successfully!');
    } catch (err) {
      console.error(err);
      showToast('⚠ Failed to export PDF.');
    }
  };

  const handleCopyNotes = () => {
    handleCopyContent(notesContent, 'Notes');
    setCopiedNotes(true);
    setTimeout(() => setCopiedNotes(false), 2000);
  };

  const handleDownloadMarkdown = () => {
    const element = document.createElement("a");
    const file = new Blob([notesContent], {type: 'text/markdown'});
    element.href = URL.createObjectURL(file);
    element.download = `StudyNotes.md`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handlePrintNotes = () => {
    const printWindow = window.open('', '_blank');
    const docsLabel = selectedDocs.length === 1 ? selectedDocs[0] : `${selectedDocs.length} documents`;
    const formattedDate = getISTTimestamp();
    
    printWindow.document.write(`
      <html>
        <head>
          <title>AI Study Notes - ${docsLabel}</title>
          <style>
            body {
              font-family: 'Georgia', 'Times New Roman', serif;
              color: #1a1a1a;
              line-height: 1.6;
              padding: 40px;
              max-width: 800px;
              margin: 0 auto;
            }
            .header {
              border-bottom: 2px solid #b38728;
              padding-bottom: 10px;
              margin-bottom: 30px;
            }
            .header h1 {
              margin: 0;
              font-family: 'Helvetica Neue', Arial, sans-serif;
              color: #0a0e1a;
              font-size: 28px;
            }
            .header .metadata {
              font-size: 12px;
              color: #666;
              margin-top: 5px;
              font-family: monospace;
            }
            h1, h2, h3, h4 {
              font-family: 'Helvetica Neue', Arial, sans-serif;
              color: #0a0e1a;
            }
            h1 { font-size: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-top: 30px; }
            h2 { font-size: 20px; color: #b38728; margin-top: 25px; }
            h3 { font-size: 16px; margin-top: 20px; }
            p { margin-bottom: 15px; text-align: justify; }
            ul, ol { margin-bottom: 20px; padding-left: 25px; }
            li { margin-bottom: 5px; }
            blockquote {
              background: #fbf9f4;
              border-left: 4px solid #b38728;
              padding: 15px 20px;
              margin: 20px 0;
              font-style: italic;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 25px 0;
              font-size: 14px;
            }
            th, td {
              border: 1px solid #cbd5e1;
              padding: 10px 12px;
              text-align: left;
            }
            th {
              background-color: #0f172a;
              color: white;
              font-weight: bold;
            }
            tr:nth-child(even) {
              background-color: #f8fafc;
            }
            pre {
              background-color: #f1f5f9;
              border: 1px solid #cbd5e1;
              padding: 15px;
              border-radius: 5px;
              overflow-x: auto;
              font-family: monospace;
              font-size: 13px;
            }
            code {
              font-family: monospace;
              background-color: #f1f5f9;
              padding: 2px 4px;
              border-radius: 3px;
              font-size: 13px;
            }
            @media print {
              body { padding: 0; }
              button { display: none; }
            }
          </style>
          <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
        </head>
        <body>
          <div class="header">
            <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 2px; font-weight: bold; color: #b38728;">Yeseswini's AI Study Assistant</div>
            <h1>\${selectedDocs.length === 1 ? selectedDocs[0].replace('.pdf', '') : 'Combined Study Notes'}</h1>
            <div class="metadata">
              Generated from \${selectedDocs.length} PDFs • \${formattedDate}
            </div>
          </div>
          <div id="content"></div>
          <script>
            document.getElementById('content').innerHTML = marked.parse(\`\${notesContent.replace(/\`/g, '\\\\\`').replace(/\\$/g, '\\\\$')}\`);
            window.onload = function() {
              window.print();
              setTimeout(() => window.close(), 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleRunTool = async () => {
    if (selectedDocs.length === 0) {
      setError('Please select at least one document from your library.');
      return;
    }
    setError('');

    // Pre-validate counts
    if (activeTool === 'flashcards') {
      if (!flashcardCount || flashcardCount <= 0) {
        setError('Please enter a flashcard count greater than zero.');
        return;
      }
      if (flashcardCount > 50) {
        setError('Maximum flashcard count allowed is 50.');
        return;
      }
    } else if (activeTool === 'quiz') {
      if (!quizCount || quizCount <= 0) {
        setError('Please enter a quiz question count greater than zero.');
        return;
      }
      if (quizCount > 50) {
        setError('Maximum quiz question count allowed is 50.');
        return;
      }
    }

    setLoading(true);
    
    try {
      const docsLabel = selectedDocs.length === 1 ? selectedDocs[0] : `${selectedDocs.length} documents`;

      // Smart Limitation Logic validation
      if (activeTool === 'flashcards' || activeTool === 'quiz') {
        const countVal = activeTool === 'flashcards' ? flashcardCount : quizCount;
        const validation = await validateLimit(selectedDocs, activeTool, countVal);
        if (!validation.valid) {
          setError(validation.message);
          setLoading(false);
          return;
        }
      }

      if (activeTool === 'summary') {
        const res = await generateSummary(selectedDocs, explanationMode, 'strict_rag', responseDepth);
        setSummaryData(res.summary);
      } else if (activeTool === 'flashcards') {
        const res = await generateFlashcards(selectedDocs, explanationMode, 'strict_rag', responseDepth, flashcardCount);
        setFlashcards(res.flashcards);
        setFlashcardsSourceIndicator(res.source_indicator || '');
        setActiveCardIdx(0);
        setIsFlipped(false);
      } else if (activeTool === 'quiz') {
        const res = await generateQuiz(selectedDocs, explanationMode, 'strict_rag', responseDepth, quizCount);
        const formattedQuiz = res.quiz.map((q, index) => {
          const options = q.options.map((opt, oIdx) => ({
            id: `q-${index}-opt-${oIdx}`,
            text: opt
          }));
          const correctOpt = options.find(o => o.text.trim() === q.correct_answer.trim()) || 
                             options.find(o => o.text.trim().toLowerCase() === q.correct_answer.trim().toLowerCase()) || 
                             options[0];
          return {
            id: `q-${index}`,
            question: q.question,
            options: options,
            correctOptionId: correctOpt.id,
            selectedOptionId: null,
            isCorrect: null,
            explanation: q.explanation,
            answered: false
          };
        });
        setQuizQuestions(formattedQuiz);
        setQuizSourceIndicator(res.source_indicator || '');
        setQuizSubmitted(false);
        setCurrentQuestionIdx(0);
      } else if (activeTool === 'questions') {
        const res = await generateQuestions(selectedDocs, explanationMode, 'strict_rag', responseDepth);
        setImportantQuestions(res.questions);
      } else if (activeTool === 'formulas') {
        const res = await extractFormulas(selectedDocs, explanationMode, 'strict_rag', responseDepth);
        setExtractedFormulas(res.formulas);
      } else if (activeTool === 'definitions') {
        const res = await extractDefinitions(selectedDocs, explanationMode, 'strict_rag', responseDepth);
        setExtractedDefinitions(res.definitions);
      } else if (activeTool === 'notes') {
        setNotesContent('');
        let accumulated = `# AI Study Notes — ${getISTTimestamp()}\n\n`;
        setNotesContent(accumulated);
        await streamNotes({
          filenames: selectedDocs,
          notesMode: notesGenMode,
          explanationMode: explanationMode,
          knowledgeMode: 'strict_rag',
          responseDepth: responseDepth,
          onChunk: (chunk) => {
            accumulated += chunk;
            setNotesContent(accumulated);
          },
          onError: (err) => {
            setError(err || 'Failed to stream notes.');
          },
          onDone: () => {}
        });
      }
    } catch (e) {
      setError(e.message || 'Error processing request');
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = async () => {
    try {
      const docsLabel = selectedDocs.length === 1 ? selectedDocs[0] : `${selectedDocs.length} documents`;
      await exportNotes(notesContent, `Study Notes - ${docsLabel} - ${getISTTimestamp()}`);
    } catch (e) {
      setError('Failed to export notes to PDF');
    }
  };

  const handleAddToWorkspace = (type, data) => {
    if (!data || (Array.isArray(data) && data.length === 0)) {
      showToast("⚠ No content to add. Generate something first!");
      return;
    }

    let title = '';
    let contentMarkdown = '';
    const timestamp = getISTTimestamp();

    if (type === 'summary') {
      title = 'AI Summary';
      contentMarkdown = data.trim();
    } else if (type === 'formulas') {
      title = 'Formula Sheet';
      contentMarkdown = data.trim();
    } else if (type === 'definitions') {
      title = 'Terminology Glossary';
      contentMarkdown = data.trim();
    } else if (type === 'questions') {
      title = 'Important Questions';
      contentMarkdown = data.trim();
    } else if (type === 'flashcards') {
      title = 'Flashcard Insights';
      contentMarkdown = data.map((card, idx) => `### Card ${idx + 1}\n**Question:** ${card.question}\n**Answer:** ${card.answer}\n`).join('\n');
    } else if (type === 'quiz') {
      title = 'Quiz Performance';
      contentMarkdown = data.map((q, idx) => {
        const userOpt = q.options.find(o => o.id === q.selectedOptionId);
        const correctOpt = q.options.find(o => o.id === q.correctOptionId);
        const userAnswerText = userOpt ? userOpt.text : 'Unanswered';
        const correctOptionText = correctOpt ? correctOpt.text : 'N/A';
        return `### Question ${idx + 1}: ${q.question}\n- **Your Answer:** ${userAnswerText} ${q.isCorrect ? '✅' : '❌'}\n- **Correct Answer:** ${correctOptionText}\n- **Explanation:** ${q.explanation}\n`;
      }).join('\n');
    }

    const divider = notesContent.trim() ? '\n\n---\n\n' : '';
    const header = `# ${title} — ${timestamp}\n\n`;
    const newNotes = notesContent.trim() ? (notesContent + divider + header + contentMarkdown) : (header + contentMarkdown);

    setNotesContent(newNotes);
    showToast(`✅ Added to Study Workspace`);
  };

  // Quiz evaluation helper
  const handleOptionSelect = (qIdx, optionId) => {
    const q = quizQuestions[qIdx];
    if (!q || q.answered) return; // lock question once answered

    const updatedQuestions = [...quizQuestions];
    updatedQuestions[qIdx] = {
      ...q,
      selectedOptionId: optionId,
      isCorrect: optionId === q.correctOptionId,
      answered: true
    };
    
    // Debug log verification as requested in point 12
    console.log("Quiz Debug -> Selected ID:", optionId, "Correct ID:", q.correctOptionId, "isCorrect:", optionId === q.correctOptionId);
    
    setQuizQuestions(updatedQuestions);
  };

  const calculateScore = () => {
    return quizQuestions.filter(q => q.isCorrect === true).length;
  };

  const handleRetry = () => {
    const resetQuestions = quizQuestions.map(q => ({
      ...q,
      selectedOptionId: null,
      isCorrect: null,
      answered: false
    }));
    setQuizQuestions(resetQuestions);
    setQuizSubmitted(false);
    setCurrentQuestionIdx(0);
  };

  // Modern Markdown Renderer inside tools
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

  // Custom highlights helper
  const highlightText = (text, query) => {
    if (!query || typeof text !== 'string') return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, index) => 
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={index} className="bg-gold/35 text-navy-950 px-1 py-0.2 rounded font-semibold border-b border-gold/50">{part}</mark>
        : part
    );
  };

  // Advanced Markdown Renderer for Notes Workspace
  const NotesMarkdownRenderer = ({ text }) => {
    const processedText = preprocessMarkdown(text);
    return (
      <div className="markdown-body leading-relaxed text-slate-200 text-xs sm:text-sm">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({node, children, ...props}) => {
              if (notesSearchQuery && typeof children === 'string') {
                return <p className="mb-4" {...props}>{highlightText(children, notesSearchQuery)}</p>;
              }
              return <p className="mb-4" {...props}>{children}</p>;
            },
            li: ({node, children, ...props}) => {
              if (notesSearchQuery && typeof children === 'string') {
                return <li {...props}>{highlightText(children, notesSearchQuery)}</li>;
              }
              return <li {...props}>{children}</li>;
            },
            blockquote: ({node, children, ...props}) => (
              <blockquote {...props}>
                <div className="absolute top-0 right-0 w-24 h-24 bg-gold/5 rounded-full blur-2xl pointer-events-none"></div>
                <div className="font-semibold text-gold-light text-[10px] uppercase tracking-wider mb-2 flex items-center gap-1.5 not-italic select-none">
                  <Sparkles className="w-3.5 h-3.5 text-gold fill-gold/10" />
                  <span>Study Insight / Exam Tip</span>
                </div>
                {children}
              </blockquote>
            )
          }}
        >
          {processedText}
        </ReactMarkdown>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden h-full relative z-10">
      
      {/* Left Content Panel */}
      <div className="w-full md:w-64 p-4 border-b md:border-b-0 md:border-r border-white/5 flex flex-col gap-6 select-none bg-slate-950/45 flex-shrink-0 overflow-y-auto">
        {/* Document Selection Section */}
        <div className="space-y-2">
          <div className="flex justify-between items-center px-1">
            <h4 className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Documents</h4>
            <span className="text-[9px] text-gold font-bold">({selectedDocs.length} selected)</span>
          </div>
          
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="custom-dropdown-trigger"
            >
              <span className="truncate text-slate-300 font-medium">{getDropdownLabel()}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            </button>
            
            {isDropdownOpen && (
              <div className="custom-dropdown-menu animate-fadeIn">
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
                
                <div className="dropdown-actions">
                  <button 
                    type="button"
                    onClick={() => setSelectedDocs(documents.map(d => d.filename))}
                    className="text-gold hover:text-gold-light transition"
                  >
                    Select All
                  </button>
                  <button 
                    type="button"
                    onClick={() => setSelectedDocs([])}
                    className="text-slate-400 hover:text-white transition"
                  >
                    Clear Selection
                  </button>
                </div>
                
                <div className="overflow-y-auto max-h-48 divide-y divide-white/5">
                  {filteredDocs.length > 0 ? (
                    filteredDocs.map((doc, idx) => {
                      const isSelected = selectedDocs.includes(doc.filename);
                      return (
                        <div
                          key={idx}
                          onClick={() => toggleDoc(doc.filename)}
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

        {/* Upload Document Section */}
        <div className="space-y-2">
          <div 
            onClick={() => fileInputRef.current.click()}
            className="border border-dashed border-white/10 hover:border-gold/30 hover:bg-white/5 rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer transition-all bg-slate-950/20"
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

        {/* Study Tool List */}
        <div className="space-y-2 flex-1 flex flex-col min-h-0">
          <h4 className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Study Tools</h4>
          
          <div className="space-y-1.5 overflow-y-auto flex-1 pr-1">
            {[
              { id: 'summary', label: 'AI Summaries', icon: FileText },
              { id: 'flashcards', label: 'AI Flashcards', icon: Sparkles },
              { id: 'quiz', label: 'AI Quiz Builder', icon: HelpCircle },
              { id: 'questions', label: 'Important Questions', icon: ClipboardList },
              { id: 'formulas', label: 'Formula Sheet', icon: PenTool },
              { id: 'definitions', label: 'Terminology Glossary', icon: BookOpen },
              { id: 'notes', label: 'Study Workspace', icon: Edit3 },
            ].map((tool) => {
              const ToolIcon = tool.icon;
              const isActive = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => setActiveTool(tool.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-xs font-semibold transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-r from-gold-dark/20 to-gold/5 border border-gold/30 text-gold-light'
                      : 'hover:bg-white/5 border border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ToolIcon className={`w-4 h-4 ${isActive ? 'text-gold' : 'text-slate-400'}`} />
                  <span>{tool.label}</span>
                </button>
              );
            })}
          </div>

          {/* Notes depth mode switcher - show ONLY when activeTool is notes */}
          {activeTool === 'notes' && (
            <div className="pt-4 border-t border-white/5 space-y-2 flex-shrink-0">
              <h5 className="text-[9px] uppercase font-extrabold tracking-wider text-slate-500">Workspace Depth</h5>
              <div className="grid grid-cols-3 gap-1 bg-slate-950/50 p-1 rounded-xl border border-white/5 select-none">
                {[
                  { id: 'quick', label: 'Quick' },
                  { id: 'detailed', label: 'Detailed' },
                  { id: 'deep', label: 'Deep' }
                ].map((mode) => {
                  const isModeActive = notesGenMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setNotesGenMode(mode.id)}
                      className={`py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all duration-200 ${
                        isModeActive ? 'bg-gold text-navy-950 shadow' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Content Panel - Workspace */}
      <div className="flex-1 flex flex-col overflow-hidden h-full">
        {/* Top Horizontal Toolbar */}
        <div className="glass-panel border-b border-white/5 px-5 py-2.5 flex justify-between items-center z-10 shadow-md flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-gold" />
            <h3 className="text-sm font-semibold tracking-wide text-gold-light uppercase font-academic">
              {activeTool === 'summary' && 'AI Summaries'}
              {activeTool === 'flashcards' && 'AI Flashcards'}
              {activeTool === 'quiz' && 'AI Quiz Builder'}
              {activeTool === 'questions' && 'Important Questions'}
              {activeTool === 'formulas' && 'Formula Sheet'}
              {activeTool === 'definitions' && 'Terminology Glossary'}
              {activeTool === 'notes' && 'Study Workspace'}
            </h3>
          </div>

          <div className="flex items-center gap-4">
            {/* Response Depth Switch (hidden for notes/edit workspace since it uses its own generator) */}
            {activeTool !== 'notes' && (
              <div className="flex bg-slate-950/40 p-1 rounded-xl border border-white/5 select-none control-bar-pill">
                {[
                  { id: 'concise', label: 'Concise' },
                  { id: 'standard', label: 'Standard' },
                  { id: 'detailed', label: 'Detailed' }
                ].map((depth) => {
                  const isActive = responseDepth === depth.id;
                  let activeClass = '';
                  if (isActive) {
                    activeClass = 'bg-gold/10 text-gold-light font-extrabold border-gold/30 active-pill';
                  }
                  return (
                    <button
                      key={depth.id}
                      type="button"
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
            )}

            {(activeTool === 'flashcards' || activeTool === 'quiz') && (
              <div className="flex items-center gap-2 bg-slate-950/40 px-3 py-1.5 rounded-xl border border-white/10 text-[9px] uppercase font-bold tracking-wider text-slate-400 select-none shadow-inner focus-within:border-gold/30 transition-all duration-300 control-bar-pill">
                <span>{activeTool === 'flashcards' ? 'Flashcards Count' : 'Number of Questions'}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTool === 'flashcards') {
                        setFlashcardCount(p => Math.max(5, p - 1));
                      } else {
                        setQuizCount(p => Math.max(3, p - 1));
                      }
                    }}
                    className="px-1.5 text-slate-500 hover:text-gold transition font-bold"
                  >
                    -
                  </button>
                  <input
                    type="text"
                    pattern="[0-9]*"
                    inputMode="numeric"
                    value={activeTool === 'flashcards' ? flashcardCount : quizCount}
                    onChange={(e) => {
                      const val = parseInt(e.target.value.replace(/\D/g, ''));
                      const clampedVal = isNaN(val) ? '' : val;
                      if (activeTool === 'flashcards') {
                        setFlashcardCount(clampedVal);
                      } else {
                        setQuizCount(clampedVal);
                      }
                    }}
                    onBlur={() => {
                      if (activeTool === 'flashcards') {
                        if (!flashcardCount || flashcardCount < 5) setFlashcardCount(5);
                        if (flashcardCount > 50) setFlashcardCount(50);
                      } else {
                        if (!quizCount || quizCount < 3) setQuizCount(5);
                        if (quizCount > 50) setQuizCount(50);
                      }
                    }}
                    className="w-8 bg-transparent text-center text-gold font-bold focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTool === 'flashcards') {
                        setFlashcardCount(p => Math.min(50, p + 1));
                      } else {
                        setQuizCount(p => Math.min(50, p + 1));
                      }
                    }}
                    className="px-1.5 text-slate-500 hover:text-gold transition font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* Quick Run Tool Action Button */}
            {activeTool !== 'notes' && hasGeneratedData && (
              <button
                type="button"
                onClick={handleRunTool}
                disabled={loading || selectedDocs.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-gold-dark to-gold text-navy-950 hover:opacity-90 active:scale-95 transition text-xs font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-navy-950" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 fill-navy-950 text-navy-950" />
                )}
                <span>{loading ? 'Running...' : getCtaLabel(activeTool, true)}</span>
              </button>
            )}
          </div>
        </div>

        {/* WORKSPACE MAIN AREA */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0 relative flex flex-col bg-slate-900/10">

        {selectedDocs.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5 items-center bg-slate-950/20 p-2 rounded-xl border border-white/5 flex-shrink-0 animate-fadeIn">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mr-1.5">Active Files ({selectedDocs.length}):</span>
            {selectedDocs.map((doc, idx) => (
              <div 
                key={idx}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gold/10 border border-gold/20 text-gold-light text-[10px] font-medium max-w-[220px]"
              >
                <span className="truncate">{doc}</span>
                <button 
                  type="button" 
                  onClick={() => setSelectedDocs(prev => prev.filter(f => f !== doc))}
                  className="hover:text-white text-gold/60 transition flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="bg-rose-950/25 border border-rose-500/20 text-rose-400 px-4 py-3 rounded-xl text-xs mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="h-full flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-8 h-8 text-gold animate-spin" />
            <p className="text-xs text-slate-400 italic">Synthesizing study artifacts using Groq LLM...</p>
          </div>
        ) : (
          <div className="h-full">
            {/* Tool Renderers */}

            {/* A. Summary Renderer */}
            {activeTool === 'summary' && (
              <div className="glass-card rounded-2xl p-6 h-full overflow-y-auto relative flex flex-col">
                <div className="flex justify-between items-center mb-5 pb-3 border-b border-white/5 flex-shrink-0">
                  <h3 className="font-academic text-base font-bold text-gold-light">Document Executive Summary</h3>
                  <div className="flex items-center gap-3">
                    {summaryData && (
                      <>
                        <button 
                          onClick={() => handleAddToWorkspace('summary', summaryData)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gold/10 border border-gold/30 text-gold hover:bg-gold hover:text-navy-950 transition font-bold text-xs shadow-sm"
                          title="Add to Study Workspace"
                        >
                          <Sparkles className="w-3.5 h-3.5 fill-current" />
                          <span>✨ Add to Study Workspace</span>
                        </button>
                        <button 
                          onClick={() => handleCopyContent(summaryData, 'Summary')}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-gold transition font-semibold"
                          title="Copy Summary to Clipboard"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </button>
                        <button 
                          onClick={() => handleExportPDFContent(summaryData, 'Executive Summary')}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-gold transition font-semibold"
                          title="Download Notes as PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto pr-1">
                  {summaryData ? (
                    <MarkdownRenderer text={summaryData} />
                  ) : (
                    <PlaceholderMessage 
                      text="✨ Generate a structured executive summary from your selected study materials." 
                      activeTool={activeTool}
                      onExecute={handleRunTool}
                      loading={loading}
                      hasDocsSelected={selectedDocs.length > 0}
                    />
                  )}
                </div>
              </div>
            )}

            {/* B. Flashcard Interactive Carousel */}
            {activeTool === 'flashcards' && (
              <div className="h-full flex flex-col justify-between">
                <div className="glass-card rounded-2xl p-5 border-b border-white/5 flex-shrink-0 flex justify-between items-center flex-wrap gap-2">
                  <div>
                    <h3 className="font-academic text-base font-bold text-gold-light">Interactive Study Flashcards</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">Click to flip card. Click arrows to navigate.</p>
                  </div>
                  {flashcards.length > 0 && (
                    <button 
                      onClick={() => handleAddToWorkspace('flashcards', flashcards)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gold/10 border border-gold/30 text-gold hover:bg-gold hover:text-navy-950 transition font-bold text-xs shadow-sm"
                      title="Add Flashcards to Study Workspace"
                    >
                      <Sparkles className="w-3.5 h-3.5 fill-current" />
                      <span>✨ Add to Study Workspace</span>
                    </button>
                  )}
                </div>

                {flashcards.length > 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center space-y-6 py-6 min-h-0">
                    {/* Card container */}
                    <div 
                      onClick={() => setIsFlipped(!isFlipped)}
                      className="w-full max-w-md h-60 cursor-pointer relative perspective"
                    >
                      {/* Card Flip Transition Wrapper */}
                      <div className={`w-full h-full relative transition-all duration-500 transform-style ${isFlipped ? 'rotate-y-180' : ''}`}>
                        {/* Front (Question) */}
                        <div className="absolute inset-0 backface-hidden glass-panel border border-gold/30 rounded-2xl flex flex-col justify-between p-6 shadow-2xl">
                          <span className="text-[9px] uppercase font-bold text-gold tracking-widest bg-gold/10 px-2 py-0.5 rounded-full w-max border border-gold/20">Question {activeCardIdx + 1} of {flashcards.length}</span>
                          <div className="text-sm sm:text-base font-semibold text-center text-slate-100 px-2 leading-relaxed flex items-center justify-center flex-1">
                            <InlineMarkdownRenderer text={flashcards[activeCardIdx].question} />
                          </div>
                          <span className="text-[9px] text-slate-500 text-center font-bold tracking-wider">CLICK TO REVEAL ANSWER</span>
                        </div>
                        {/* Back (Answer) */}
                        <div className="absolute inset-0 backface-hidden rotate-y-180 glass-panel border border-emerald-500/30 bg-emerald-950/10 rounded-2xl flex flex-col justify-between p-6 shadow-2xl">
                          <span className="text-[9px] uppercase font-bold text-emerald-400 tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded-full w-max border border-emerald-500/20">Answer</span>
                          <div className="text-sm sm:text-base font-medium text-center text-slate-200 px-2 leading-relaxed flex items-center justify-center flex-1">
                            <InlineMarkdownRenderer text={flashcards[activeCardIdx].answer} />
                          </div>
                          <span className="text-[9px] text-slate-500 text-center font-bold tracking-wider">CLICK TO FLIP BACK</span>
                        </div>
                      </div>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <button 
                        onClick={() => {
                          setActiveCardIdx(p => Math.max(0, p - 1));
                          setIsFlipped(false);
                        }}
                        disabled={activeCardIdx === 0}
                        className="p-2 rounded-xl bg-slate-950 border border-white/5 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 transition-all"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <span className="text-xs font-semibold text-slate-300 font-mono">{activeCardIdx + 1} / {flashcards.length}</span>
                      <button 
                        onClick={() => {
                          setActiveCardIdx(p => Math.min(flashcards.length - 1, p + 1));
                          setIsFlipped(false);
                        }}
                        disabled={activeCardIdx === flashcards.length - 1}
                        className="p-2 rounded-xl bg-slate-950 border border-white/5 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 transition-all"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <PlaceholderMessage 
                    text="✨ Generate interactive flashcards from your selected study materials." 
                    activeTool={activeTool}
                    onExecute={handleRunTool}
                    loading={loading}
                    hasDocsSelected={selectedDocs.length > 0}
                  />
                )}
              </div>
            )}

            {/* C. Quiz Builder */}
            {activeTool === 'quiz' && (
              <div className="glass-card rounded-2xl p-6 h-full overflow-y-auto space-y-5">
                <div className="flex justify-between items-center pb-3 border-b border-white/5 flex-wrap gap-2">
                  <div className="flex flex-col">
                    <h3 className="font-academic text-base font-bold text-gold-light">Active Quiz Dashboard</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    {quizQuestions.length > 0 && (
                      <button 
                        onClick={() => handleAddToWorkspace('quiz', quizQuestions)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gold/10 border border-gold/30 text-gold hover:bg-gold hover:text-navy-950 transition font-bold text-xs shadow-sm"
                        title="Add Quiz Performance to Study Workspace"
                      >
                        <Sparkles className="w-3.5 h-3.5 fill-current" />
                        <span>✨ Add to Study Workspace</span>
                      </button>
                    )}
                    {quizQuestions.length > 0 && (
                      <div className="flex items-center gap-3 text-xs font-bold text-slate-300 bg-slate-950/40 px-3 py-1.5 rounded-xl border border-white/5 font-sans shadow select-none">
                        <Award className="w-4 h-4 text-gold" />
                        <span>Score: {calculateScore()} Correct</span>
                      </div>
                    )}
                  </div>
                </div>

                {quizQuestions.length > 0 ? (
                  !quizSubmitted ? (
                    // 1. Single Question Quiz Flow
                    <div className="space-y-6">
                      {/* Progress Tracker and Bar */}
                      <div className="bg-slate-950/20 border border-white/5 rounded-2xl p-4 shadow-sm select-none animate-fadeIn">
                        <div className="flex justify-between text-xs font-bold text-slate-400">
                          <span>Question {currentQuestionIdx + 1} of {quizQuestions.length}</span>
                          <span className="text-gold">{Math.round(((currentQuestionIdx + 1) / quizQuestions.length) * 100)}% Complete</span>
                        </div>
                        <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-white/5 mt-2 mb-4">
                          <div 
                            className="bg-gold h-full transition-all duration-300" 
                            style={{ width: `${((currentQuestionIdx + 1) / quizQuestions.length) * 100}%` }}
                          ></div>
                        </div>

                        {/* Interactive Clickable Question Indicators */}
                        <div className="flex flex-wrap gap-2 justify-center pt-3 border-t border-white/5">
                          {quizQuestions.map((_, idx) => {
                            const isCurrent = idx === currentQuestionIdx;
                            const q = quizQuestions[idx];
                            const isAnswered = q.answered;
                            
                            let indicatorStyle = '';
                            if (isAnswered) {
                              if (q.isCorrect) {
                                indicatorStyle = 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20';
                              } else {
                                indicatorStyle = 'border-rose-500/30 text-rose-400 bg-rose-500/10 hover:bg-rose-500/20';
                              }
                            } else {
                              indicatorStyle = 'border-white/10 text-slate-400 hover:border-gold/30 hover:text-slate-200 bg-slate-950/20';
                            }
                            if (isCurrent) {
                              indicatorStyle += ' ring-2 ring-gold border-gold font-bold scale-[1.05]';
                            }

                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setCurrentQuestionIdx(idx)}
                                className={`w-8 h-8 rounded-lg border text-xs flex items-center justify-center transition-all ${indicatorStyle}`}
                                title={`Go to Question ${idx + 1}`}
                              >
                                {idx + 1}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Active Question Card */}
                      {(() => {
                        const q = quizQuestions[currentQuestionIdx];
                        const hasAnswered = q.answered;

                        return (
                          <div className="bg-slate-950/30 border border-white/5 rounded-2xl p-5 space-y-5 shadow-lg">
                            <span className="text-[9px] uppercase font-bold text-gold tracking-wider bg-gold/10 px-2.5 py-0.5 rounded-full border border-gold/20">Active Question</span>
                            <div className="text-xs sm:text-sm font-semibold text-slate-100 leading-relaxed">
                              <InlineMarkdownRenderer text={q.question} />
                            </div>

                            <div className="grid grid-cols-1 gap-2.5">
                              {q.options.map((opt, oIdx) => {
                                const isSelected = q.selectedOptionId === opt.id;
                                const isCorrect = opt.id === q.correctOptionId;
                                
                                let statusClass = '';
                                if (hasAnswered) {
                                  if (isCorrect) {
                                    statusClass = 'correct';
                                  } else if (isSelected) {
                                    statusClass = 'incorrect';
                                  } else {
                                    statusClass = 'dimmed';
                                  }
                                }

                                return (
                                  <button
                                    key={oIdx}
                                    onClick={() => handleOptionSelect(currentQuestionIdx, opt.id)}
                                    disabled={hasAnswered}
                                    className={`quiz-option ${statusClass}`}
                                  >
                                    <div className="flex-1">
                                      <InlineMarkdownRenderer text={opt.text} />
                                    </div>
                                    {hasAnswered && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
                                    {hasAnswered && isSelected && !isCorrect && <X className="w-4 h-4 text-rose-400 flex-shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Real-time Inline Feedback */}
                            {hasAnswered && (
                              <div className="space-y-4 pt-4 border-t border-white/5 animate-fadeIn">
                                {q.isCorrect ? (
                                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-2.5 rounded-xl shadow-sm">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                    <span>Correct! Exceptional job.</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 text-xs font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3.5 py-2.5 rounded-xl shadow-sm">
                                    <X className="w-4 h-4 text-rose-400" />
                                    <span>Incorrect. The correct answer is: <strong>{q.options.find(o => o.id === q.correctOptionId)?.text}</strong></span>
                                  </div>
                                )}

                                <div className="p-4 rounded-xl bg-slate-950/60 border-l-4 border-gold text-xs text-slate-400 leading-relaxed shadow-inner">
                                  <strong className="text-gold-light font-bold block mb-1">Explanation:</strong>
                                  <InlineMarkdownRenderer text={q.explanation} />
                                </div>
                              </div>
                            )}

                            {/* Permanent Navigation Footer inside Question Card */}
                            <div className="pt-4 flex justify-between items-center border-t border-white/5 mt-4 select-none">
                              <button
                                type="button"
                                onClick={() => setCurrentQuestionIdx(p => Math.max(0, p - 1))}
                                disabled={currentQuestionIdx === 0}
                                className="px-4 py-2 rounded-xl bg-slate-950/40 border border-white/10 text-slate-300 hover:text-white disabled:opacity-30 disabled:hover:text-slate-300 transition-all text-xs flex items-center gap-1.5 font-bold"
                              >
                                <ChevronLeft className="w-4 h-4" />
                                <span>Previous</span>
                              </button>

                              {currentQuestionIdx < quizQuestions.length - 1 ? (
                                <button
                                  type="button"
                                  onClick={() => setCurrentQuestionIdx(p => Math.min(quizQuestions.length - 1, p + 1))}
                                  className="px-4 py-2 rounded-xl bg-slate-950/40 border border-white/10 text-slate-300 hover:text-white transition-all text-xs flex items-center gap-1.5 font-bold"
                                >
                                  <span>Next</span>
                                  <ChevronRight className="w-4 h-4" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setQuizSubmitted(true)}
                                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-bold hover:opacity-90 active:scale-95 transition-all text-xs flex items-center gap-1.5 shadow"
                                >
                                  <Award className="w-4 h-4" />
                                  <span>Finish Quiz</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    // 2. Full Completion Review & Analytics Card
                    <div className="space-y-6 animate-fadeIn">
                      <div className="bg-slate-950/40 border border-gold/20 rounded-2xl p-8 text-center space-y-4 shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-gold/5 rounded-full blur-2xl pointer-events-none"></div>
                        <div className="inline-flex p-4 rounded-full bg-gold/15 border border-gold/30 shadow-lg text-gold mb-2 animate-float">
                          <Award className="w-10 h-10" />
                        </div>
                        <h3 className="font-academic text-xl font-bold text-white tracking-wide">Quiz Completed!</h3>
                        <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                          {calculateScore() >= quizQuestions.length * 0.8 
                            ? "Exceptional work! You have shown deep comprehension of these study materials." 
                            : calculateScore() >= quizQuestions.length * 0.5 
                              ? "Solid effort. You've grabbed the core concepts, but there's room for reinforcement."
                              : "Reviewing the materials again is recommended to master this subject."}
                        </p>

                        <div className="text-2xl font-extrabold text-gold font-mono py-1.5">
                          {calculateScore()} / {quizQuestions.length} Correct
                          <span className="text-sm font-semibold text-slate-400 ml-2">({Math.round((calculateScore() / quizQuestions.length) * 100)}%)</span>
                        </div>

                        <div className="pt-2">
                          <button
                            onClick={handleRetry}
                            className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/10 text-slate-300 hover:text-white transition-all text-xs font-bold shadow"
                          >
                            Reset & Try Again
                          </button>
                        </div>
                      </div>

                      {/* Detailed Review Section */}
                      <div className="space-y-4">
                        <h4 className="text-[10px] uppercase font-bold tracking-widest text-slate-500 px-1">Detailed Question Review</h4>
                        <div className="space-y-4">
                          {quizQuestions.map((q, qIdx) => {
                            const userOpt = q.options.find(o => o.id === q.selectedOptionId);
                            const correctOpt = q.options.find(o => o.id === q.correctOptionId);
                            const userAnswerText = userOpt ? userOpt.text : '[No Answer Selected]';
                            const correctOptionText = correctOpt ? correctOpt.text : 'N/A';
                            return (
                              <div key={qIdx} className="bg-slate-950/20 border border-white/5 rounded-2xl p-5 space-y-3 shadow-sm">
                                <div className="flex justify-between items-center">
                                  <span className="text-[9px] uppercase font-bold text-gold tracking-wider bg-gold/10 px-2 py-0.5 rounded-full border border-gold/20">Question {qIdx + 1}</span>
                                  {q.isCorrect ? (
                                    <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">Correct ✅</span>
                                  ) : (
                                    <span className="text-[9px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">Incorrect ❌</span>
                                  )}
                                </div>
                                <div className="text-xs sm:text-sm font-semibold text-slate-200 leading-relaxed">
                                  <InlineMarkdownRenderer text={q.question} />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                                  <div className={`p-2.5 rounded-lg border ${
                                    q.isCorrect 
                                      ? 'border-emerald-500/30 bg-emerald-950/10 text-emerald-400' 
                                      : 'border-rose-500/30 bg-rose-950/10 text-rose-400'
                                  }`}>
                                    <span className="font-bold text-[10px] uppercase text-slate-500 block mb-0.5">Your Answer</span>
                                    <InlineMarkdownRenderer text={userAnswerText} />
                                  </div>
                                  {!q.isCorrect && (
                                    <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-950/10 text-emerald-400">
                                      <span className="font-bold text-[10px] uppercase text-slate-500 block mb-0.5">Correct Answer</span>
                                      <InlineMarkdownRenderer text={correctOptionText} />
                                    </div>
                                  )}
                                </div>
                                <div className="p-3 bg-slate-950/40 rounded-xl text-xs text-slate-400 leading-relaxed">
                                  <strong className="text-gold-light font-bold block mb-1">Explanation:</strong>
                                  <InlineMarkdownRenderer text={q.explanation} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )
                ) : (
                  <PlaceholderMessage 
                    text="✨ Generate a practice quiz with detailed explanations from your selected study materials." 
                    activeTool={activeTool}
                    onExecute={handleRunTool}
                    loading={loading}
                    hasDocsSelected={selectedDocs.length > 0}
                  />
                )}
              </div>
            )}

            {/* D. Key Questions */}
            {activeTool === 'questions' && (
              <div className="glass-card rounded-2xl p-6 h-full overflow-y-auto relative flex flex-col">
                <div className="flex justify-between items-center mb-5 pb-3 border-b border-white/5 flex-shrink-0">
                  <h3 className="font-academic text-base font-bold text-gold-light">Important Questions & Answers</h3>
                  <div className="flex items-center gap-3">
                    {importantQuestions && (
                      <>
                        <button 
                          onClick={() => handleAddToWorkspace('questions', importantQuestions)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gold/10 border border-gold/30 text-gold hover:bg-gold hover:text-navy-950 transition font-bold text-xs shadow-sm"
                          title="Add Questions to Study Workspace"
                        >
                          <Sparkles className="w-3.5 h-3.5 fill-current" />
                          <span>✨ Add to Study Workspace</span>
                        </button>
                        <button 
                          onClick={() => handleCopyContent(importantQuestions, 'Questions')}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-gold transition font-semibold"
                          title="Copy Questions to Clipboard"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </button>
                        <button 
                          onClick={() => handleExportPDFContent(importantQuestions, 'Important Questions')}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-gold transition font-semibold"
                          title="Download Notes as PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto pr-1">
                  {importantQuestions ? (
                    <MarkdownRenderer text={importantQuestions} />
                  ) : (
                    <PlaceholderMessage 
                      text="✨ Generate high-priority exam questions and answers from your selected study materials." 
                      activeTool={activeTool}
                      onExecute={handleRunTool}
                      loading={loading}
                      hasDocsSelected={selectedDocs.length > 0}
                    />
                  )}
                </div>
              </div>
            )}

            {/* E. Formula Sheet */}
            {activeTool === 'formulas' && (
              <div className="glass-card rounded-2xl p-6 h-full overflow-y-auto relative flex flex-col">
                <div className="flex justify-between items-center mb-5 pb-3 border-b border-white/5 flex-shrink-0">
                  <h3 className="font-academic text-base font-bold text-gold-light">Extracted Formulas Sheet</h3>
                  <div className="flex items-center gap-3">
                    {extractedFormulas && (
                      <>
                        <button 
                          onClick={() => handleAddToWorkspace('formulas', extractedFormulas)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gold/10 border border-gold/30 text-gold hover:bg-gold hover:text-navy-950 transition font-bold text-xs shadow-sm"
                          title="Add Formulas to Study Workspace"
                        >
                          <Sparkles className="w-3.5 h-3.5 fill-current" />
                          <span>✨ Add to Study Workspace</span>
                        </button>
                        <button 
                          onClick={() => handleCopyContent(extractedFormulas, 'Formulas')}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-gold transition font-semibold"
                          title="Copy Formulas to Clipboard"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </button>
                        <button 
                          onClick={() => handleExportPDFContent(extractedFormulas, 'Formula Sheet')}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-gold transition font-semibold"
                          title="Download Notes as PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto pr-1">
                  {extractedFormulas ? (
                    <MarkdownRenderer text={extractedFormulas} />
                  ) : (
                    <PlaceholderMessage 
                      text="✨ Generate a comprehensive formula and key concept sheet from your selected study materials." 
                      activeTool={activeTool}
                      onExecute={handleRunTool}
                      loading={loading}
                      hasDocsSelected={selectedDocs.length > 0}
                    />
                  )}
                </div>
              </div>
            )}

            {/* F. Glossary Definitions */}
            {activeTool === 'definitions' && (
              <div className="glass-card rounded-2xl p-6 h-full overflow-y-auto relative flex flex-col">
                <div className="flex justify-between items-center mb-5 pb-3 border-b border-white/5 flex-shrink-0">
                  <h3 className="font-academic text-base font-bold text-gold-light">Terminology Glossary Sheet</h3>
                  <div className="flex items-center gap-3">
                    {extractedDefinitions && (
                      <>
                        <button 
                          onClick={() => handleAddToWorkspace('definitions', extractedDefinitions)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gold/10 border border-gold/30 text-gold hover:bg-gold hover:text-navy-950 transition font-bold text-xs shadow-sm"
                          title="Add Definitions to Study Workspace"
                        >
                          <Sparkles className="w-3.5 h-3.5 fill-current" />
                          <span>✨ Add to Study Workspace</span>
                        </button>
                        <button 
                          onClick={() => handleCopyContent(extractedDefinitions, 'Glossary')}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-gold transition font-semibold"
                          title="Copy Definitions to Clipboard"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </button>
                        <button 
                          onClick={() => handleExportPDFContent(extractedDefinitions, 'Glossary Definitions')}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-gold transition font-semibold"
                          title="Download Notes as PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto pr-1">
                  {extractedDefinitions ? (
                    <MarkdownRenderer text={extractedDefinitions} />
                  ) : (
                    <PlaceholderMessage 
                      text="✨ Generate a textbook-grade terminology glossary from your selected study materials." 
                      activeTool={activeTool}
                      onExecute={handleRunTool}
                      loading={loading}
                      hasDocsSelected={selectedDocs.length > 0}
                    />
                  )}
                </div>
              </div>
            )}

            {/* G. Notes Editor */}
            {activeTool === 'notes' && (
              <div className={`glass-card rounded-2xl flex flex-col justify-between transition-all duration-300 ${
                isFullscreenNotes 
                  ? 'fixed inset-4 z-50 p-6 bg-slate-950/95 backdrop-blur-2xl border border-gold/30 shadow-2xl' 
                  : 'h-full p-6'
              }`}>
                {/* Notes Header / Sticky Action Toolbar */}
                <div className="flex flex-col gap-4 pb-4 border-b border-white/5 mb-5 flex-shrink-0">
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                    <div className="flex items-center gap-2.5">
                      <PenTool className="w-4 h-4 text-gold" />
                      <h3 className="font-academic text-base font-bold text-gold-light">Study Workspace</h3>
                      {notesContent && (
                        <span className="text-[9px] font-extrabold tracking-wider px-2 py-0.5 rounded-full bg-gold/10 border border-gold/25 text-gold uppercase">
                          {notesGenMode === 'deep' ? 'mastery' : notesGenMode} Mode
                        </span>
                      )}
                    </div>

                    {/* Mode toggles */}
                    {notesContent && (
                      <div className="flex bg-slate-950/50 p-1 rounded-xl border border-white/5 w-max select-none">
                        <button
                          type="button"
                          onClick={() => setNotesMode('preview')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${
                            notesMode === 'preview' ? 'bg-gold text-navy-950 shadow' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>View Notebook</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotesMode('edit')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${
                            notesMode === 'edit' ? 'bg-gold text-navy-950 shadow' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit Notes</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Sticky Toolbar Actions Row */}
                  {notesContent && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-white/5">
                      {/* Local Search Input inside Notes */}
                      <div className={`flex items-center gap-2 px-3 py-1.5 bg-slate-950/40 border border-white/10 rounded-xl max-w-xs transition-all duration-200 focus-within:border-gold/30 ${
                        notesMode === 'preview' ? 'opacity-100' : 'opacity-0 pointer-events-none'
                      }`}>
                        <Search className="w-3.5 h-3.5 text-slate-500" />
                        <input
                          type="text"
                          placeholder="Search notes..."
                          value={notesSearchQuery}
                          onChange={(e) => setNotesSearchQuery(e.target.value)}
                          className="bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none w-36 sm:w-44"
                        />
                        {notesSearchQuery && (
                          <button type="button" onClick={() => setNotesSearchQuery('')} className="text-slate-500 hover:text-white flex-shrink-0">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      {/* Quick Command Buttons */}
                      <div className="flex flex-wrap items-center gap-1.5 ml-auto font-sans">
                        <button
                          type="button"
                          onClick={handleRunTool}
                          disabled={loading}
                          className="flex items-center gap-1 px-3.5 py-2 rounded-xl bg-gradient-to-r from-gold-dark to-gold text-navy-950 hover:opacity-90 active:scale-95 transition text-xs font-bold shadow-lg"
                          title="Generate Study Notes from selected PDFs"
                        >
                          {loading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5 fill-navy-950" />
                          )}
                          <span>{loading ? 'Generating...' : 'Generate Study Notes'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleCopyNotes}
                          className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-950/40 border border-white/10 text-slate-300 hover:text-gold hover:border-gold/30 transition text-xs font-semibold"
                          title="Copy to clipboard"
                        >
                          {copiedNotes ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span className="hidden sm:inline">{copiedNotes ? 'Copied!' : 'Copy Notes'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleExportPDF}
                          className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-950/40 border border-white/10 text-slate-300 hover:text-gold hover:border-gold/30 transition text-xs font-semibold"
                          title="Export as PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Export PDF</span>
                        </button>

                        <button
                          type="button"
                          onClick={handlePrintNotes}
                          className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-950/40 border border-white/10 text-slate-300 hover:text-gold hover:border-gold/30 transition text-xs font-semibold"
                          title="Print Notes"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Print Notes</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setIsFullscreenNotes(!isFullscreenNotes)}
                          className="p-2 rounded-xl bg-slate-950/40 border border-white/10 text-slate-300 hover:text-gold hover:border-gold/30 transition"
                          title={isFullscreenNotes ? "Exit Fullscreen" : "Fullscreen Mode"}
                        >
                          {isFullscreenNotes ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Notes Workspace Body (Scroll container) */}
                <div className="flex-1 overflow-y-auto min-h-0 relative pr-1">
                  {!notesContent || !notesContent.trim() ? (
                    <div className="max-w-2xl mx-auto flex flex-col items-center justify-center text-center p-8 sm:p-16 h-full min-h-[350px] animate-fadeIn">
                      <div className="p-4 rounded-full bg-gold/10 border border-gold/20 mb-6 text-gold animate-pulse">
                        <PenTool className="w-8 h-8" />
                      </div>
                      <h4 className="font-academic text-lg font-bold text-white tracking-wide mb-3">Your Personalized Study Notebook</h4>
                      <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-md mb-8">
                        Save summaries, formulas, terminology, and important study material here to build your personalized study notebook.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md text-left mb-8">
                        <div className="p-3.5 rounded-xl bg-slate-950/40 border border-white/5 flex gap-3 items-start">
                          <Sparkles className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                          <div>
                            <h5 className="text-xs font-bold text-slate-200">✨ Add Automatically</h5>
                            <p className="text-[10px] text-slate-400 mt-0.5">Use the "✨ Add to Study Workspace" action in any tool on the left to append content instantly.</p>
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-slate-950/40 border border-white/5 flex gap-3 items-start">
                          <Edit3 className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                          <div>
                            <h5 className="text-xs font-bold text-slate-200">✏️ Write & Customise</h5>
                            <p className="text-[10px] text-slate-400 mt-0.5">Switch to "Edit Notes" mode to write your own custom notes or copy/paste text.</p>
                          </div>
                        </div>
                      </div>
                      
                      {selectedDocs.length > 0 ? (
                        <button
                          type="button"
                          onClick={handleRunTool}
                          disabled={loading}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-gold-dark to-gold text-navy-950 hover:opacity-90 active:scale-95 transition text-xs font-bold shadow-lg"
                        >
                          {loading ? (
                            <Loader2 className="w-4.5 h-4.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-4.5 h-4.5 fill-navy-950" />
                          )}
                          <span>{loading ? 'Generating Notes...' : getCtaLabel(activeTool)}</span>
                        </button>
                      ) : (
                        <div className="text-xs text-slate-500 italic">
                          Select one or more study files on the left side to enable AI notes generation.
                        </div>
                      )}
                    </div>
                  ) : notesMode === 'preview' ? (
                    <div className="max-w-3xl mx-auto rounded-3xl p-6 sm:p-10 relative overflow-hidden animate-fadeIn study-notes-paper">
                      <div className="absolute top-0 right-0 w-48 h-48 bg-gold/5 rounded-full blur-3xl pointer-events-none"></div>
                      <div className="absolute bottom-0 left-0 w-48 h-48 bg-navy-500/5 rounded-full blur-3xl pointer-events-none"></div>
                      
                      {/* Document Header decoration */}
                      <div className="border-b border-white/5 pb-5 mb-8 flex flex-col gap-1">
                        <span className="text-[9px] uppercase tracking-widest font-bold text-gold">Yeseswini's study workbook</span>
                        <h1 className="font-academic text-2xl sm:text-3xl font-extrabold text-white tracking-wide">
                          {selectedDocs.length === 1 ? selectedDocs[0].replace('.pdf', '') : 'Combined Study Notes'}
                        </h1>
                        <p className="text-[10px] text-slate-500 font-mono mt-1">
                          Generated from {selectedDocs.length} PDFs • {getISTTimestamp()}
                        </p>
                      </div>

                      {/* Custom rendered content */}
                      <NotesMarkdownRenderer text={notesContent} />
                    </div>
                  ) : (
                    <textarea
                      value={notesContent}
                      onChange={(e) => setNotesContent(e.target.value)}
                      className="w-full h-full bg-slate-950/50 border border-white/5 rounded-2xl p-5 text-xs sm:text-sm font-mono text-slate-300 focus:outline-none focus:border-gold/30 resize-none shadow-inner notes-textarea"
                      placeholder="Notes Workspace. Type, structure or paste Markdown here..."
                    />
                  )}
                </div>
              </div>
            )}

            </div>
          )}
        </div>
      </div>

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

// Subcomponents for cleaner code
function activeTabMatch(active, target) {
  return active === target;
}

function PlaceholderMessage({ text, activeTool, onExecute, loading, hasDocsSelected }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center space-y-4 max-w-sm mx-auto py-8 px-4">
      <div className="p-3.5 rounded-full bg-gold/10 border border-gold/20 shadow-lg animate-float">
        <Sparkles className="w-6 h-6 text-gold" />
      </div>
      <div className="space-y-1">
        <h4 className="text-xs font-bold text-slate-200">AI Study Generator</h4>
        <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs">{text}</p>
      </div>
      
      <button
        type="button"
        onClick={onExecute}
        disabled={loading || !hasDocsSelected}
        className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-gold-dark to-gold text-navy-950 font-bold text-xs uppercase tracking-wider shadow-lg hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-navy-950" />
        ) : (
          <Sparkles className="w-3.5 h-3.5 fill-navy-950 text-navy-950" />
        )}
        <span>{loading ? 'Processing...' : getCtaLabel(activeTool)}</span>
      </button>
      
      {!hasDocsSelected && (
        <p className="text-[9px] text-rose-400 font-medium">Please select at least one document from the left sidebar to proceed.</p>
      )}
    </div>
  );
}
