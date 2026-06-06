import { supabase, isSupabaseConfigured } from './supabase';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function authenticatedFetch(url, options = {}) {
  const headers = options.headers || {};
  if (isSupabaseConfigured && supabase) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch (e) {
      console.error("Error getting Supabase token:", e);
    }
  }
  return fetch(url, {
    ...options,
    headers
  });
}

export async function uploadFiles(files, chunkSize = 1000, chunkOverlap = 200, sessionId = null) {
  const formData = new FormData();
  files.forEach(file => {
    formData.append('files', file);
  });
  formData.append('chunk_size', chunkSize);
  formData.append('chunk_overlap', chunkOverlap);
  if (sessionId) {
    formData.append('session_id', sessionId);
  }

  const response = await authenticatedFetch(`${API_BASE_URL}/api/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error('Failed to upload files');
  }
  return response.json();
}

export async function indexText(filename, text, ocrConfidence = 100.0, reconConfidence = null, semanticQuality = null, chunkSize = 1000, chunkOverlap = 200, sessionId = null) {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/index-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename,
      text,
      ocr_confidence: ocrConfidence,
      reconstruction_confidence: reconConfidence,
      semantic_quality_score: semanticQuality,
      chunk_size: chunkSize,
      chunk_overlap: chunkOverlap,
      session_id: sessionId
    }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || 'Failed to index text');
  }
  return response.json();
}

export async function correctOcrText(text) {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/ocr/correct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || 'Failed to apply AI OCR correction');
  }
  return response.json();
}

export async function listDocuments() {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/documents`);
  if (!response.ok) {
    throw new Error('Failed to load documents');
  }
  return response.json();
}

export async function deleteDocument(filename) {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/documents/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete document');
  }
  return response.json();
}

export async function clearAllDocuments() {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/documents/clear`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to clear documents');
  }
  return response.json();
}

export async function generateSummary(filenames, explanationMode = 'intermediate', knowledgeMode = 'strict_rag', responseDepth = 'standard') {
  const payload = {
    filenames: Array.isArray(filenames) ? filenames : [filenames],
    explanation_mode: explanationMode,
    knowledge_mode: knowledgeMode,
    response_depth: responseDepth
  };
  const response = await authenticatedFetch(`${API_BASE_URL}/api/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || 'Failed to generate summary');
  }
  return response.json();
}

export async function generateFlashcards(filenames, explanationMode = 'intermediate', knowledgeMode = 'strict_rag', responseDepth = 'standard', count = null) {
  const payload = {
    filenames: Array.isArray(filenames) ? filenames : [filenames],
    explanation_mode: explanationMode,
    knowledge_mode: knowledgeMode,
    response_depth: responseDepth,
    count: count
  };
  const response = await authenticatedFetch(`${API_BASE_URL}/api/flashcards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || 'Failed to generate flashcards');
  }
  return response.json();
}

export async function generateQuiz(filenames, explanationMode = 'intermediate', knowledgeMode = 'strict_rag', responseDepth = 'standard', count = null) {
  const payload = {
    filenames: Array.isArray(filenames) ? filenames : [filenames],
    explanation_mode: explanationMode,
    knowledge_mode: knowledgeMode,
    response_depth: responseDepth,
    count: count
  };
  const response = await authenticatedFetch(`${API_BASE_URL}/api/quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || 'Failed to generate quiz');
  }
  return response.json();
}

export async function validateLimit(filenames, tool, requestedCount) {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/validate-limit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filenames: Array.isArray(filenames) ? filenames : [filenames],
      tool,
      requested_count: requestedCount
    }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || 'Validation request failed');
  }
  return response.json();
}

export async function generateQuestions(filenames, explanationMode = 'intermediate', knowledgeMode = 'strict_rag', responseDepth = 'standard') {
  const payload = {
    filenames: Array.isArray(filenames) ? filenames : [filenames],
    explanation_mode: explanationMode,
    knowledge_mode: knowledgeMode,
    response_depth: responseDepth
  };
  const response = await authenticatedFetch(`${API_BASE_URL}/api/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || 'Failed to generate important questions');
  }
  return response.json();
}

export async function extractFormulas(filenames, explanationMode = 'intermediate', knowledgeMode = 'strict_rag', responseDepth = 'standard') {
  const payload = {
    filenames: Array.isArray(filenames) ? filenames : [filenames],
    explanation_mode: explanationMode,
    knowledge_mode: knowledgeMode,
    response_depth: responseDepth
  };
  const response = await authenticatedFetch(`${API_BASE_URL}/api/formulas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || 'Failed to extract formulas');
  }
  return response.json();
}

export async function extractDefinitions(filenames, explanationMode = 'intermediate', knowledgeMode = 'strict_rag', responseDepth = 'standard') {
  const payload = {
    filenames: Array.isArray(filenames) ? filenames : [filenames],
    explanation_mode: explanationMode,
    knowledge_mode: knowledgeMode,
    response_depth: responseDepth
  };
  const response = await authenticatedFetch(`${API_BASE_URL}/api/definitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || 'Failed to extract definitions');
  }
  return response.json();
}

export async function generateStudyPlan(filenames, timeframeWeeks = 4, dailyHours = 2.0) {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/planner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filenames, timeframe_weeks: timeframeWeeks, daily_hours: dailyHours }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || 'Failed to generate study planner');
  }
  return response.json();
}

export async function streamNotes({
  filenames,
  notesMode = 'detailed',
  explanationMode = 'intermediate',
  knowledgeMode = 'strict_rag',
  responseDepth = 'standard',
  onChunk,
  onError,
  onDone
}) {
  try {
    const payload = {
      filenames: Array.isArray(filenames) ? filenames : [filenames],
      notes_mode: notesMode,
      explanation_mode: explanationMode,
      knowledge_mode: knowledgeMode,
      response_depth: responseDepth
    };

    const response = await authenticatedFetch(`${API_BASE_URL}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || 'Failed to establish connection to notes API.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.trim() === '') continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'content') {
            onChunk(parsed.data);
          } else if (parsed.type === 'error') {
            onError(parsed.data);
          }
        } catch (e) {
          console.error('Failed to parse line:', line, e);
        }
      }
    }

    if (buffer.trim() !== '') {
      try {
        const parsed = JSON.parse(buffer);
        if (parsed.type === 'content') {
          onChunk(parsed.data);
        } else if (parsed.type === 'error') {
          onError(parsed.data);
        }
      } catch (e) {
        console.error('Failed to parse line:', buffer, e);
      }
    }

    if (onDone) onDone();

  } catch (error) {
    onError(error.message || 'Network error encountered.');
  }
}

export async function exportNotes(markdownContent, title = 'Study Notes') {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/export-notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown_content: markdownContent, title }),
  });
  if (!response.ok) {
    throw new Error('Failed to export notes to PDF');
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.toLowerCase().replace(/\s+/g, '_')}_notes.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export async function streamChat({
  message,
  docFilter = null,
  docFilters = null,
  explanationMode = 'intermediate',
  history = [],
  topK = 4,
  chunkSize = 1000,
  chunkOverlap = 200,
  knowledgeMode = 'strict_rag',
  responseDepth = 'standard',
  onChunk,
  onReferences,
  onError,
  onDone
}) {
  try {
    const response = await authenticatedFetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        doc_filter: docFilter,
        doc_filters: docFilters,
        explanation_mode: explanationMode,
        history,
        top_k: topK,
        chunk_size: chunkSize,
        chunk_overlap: chunkOverlap,
        knowledge_mode: knowledgeMode,
        response_depth: responseDepth
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || 'Failed to establish connection to chat API.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      
      // Store the last incomplete line back in buffer
      buffer = lines.pop();

      for (const line of lines) {
        if (line.trim() === '') continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'references') {
            onReferences(parsed.data);
          } else if (parsed.type === 'content') {
            onChunk(parsed.data);
          } else if (parsed.type === 'error') {
            onError(parsed.data);
          }
        } catch (e) {
          console.error('Failed to parse line:', line, e);
        }
      }
    }

    // Process remainder buffer
    if (buffer.trim() !== '') {
      try {
        const parsed = JSON.parse(buffer);
        if (parsed.type === 'references') {
          onReferences(parsed.data);
        } else if (parsed.type === 'content') {
          onChunk(parsed.data);
        } else if (parsed.type === 'error') {
          onError(parsed.data);
        }
      } catch (e) {
        console.error('Failed to parse line:', buffer, e);
      }
    }

    if (onDone) onDone();

  } catch (error) {
    onError(error.message || 'Network error encountered.');
  }
}

export async function exportChat(messages, sessionTitle = 'Study Session') {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/export-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, session_title: sessionTitle }),
  });
  if (!response.ok) {
    throw new Error('Failed to export chat to PDF');
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sessionTitle.toLowerCase().replace(/\s+/g, '_')}_chat.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
