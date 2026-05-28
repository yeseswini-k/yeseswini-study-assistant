import os
import re
import html
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq, AsyncGroq
import reportlab
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

from backend.config import settings
from backend.rag_service import rag_service
import fitz
import pytesseract
from PIL import Image
import io
import cv2
import easyocr
import numpy as np

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Study Assistant Pro API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper function to get Groq client
def get_groq_client():
    if not settings.GROQ_API_KEY or settings.GROQ_API_KEY == "your_groq_api_key_here":
        raise HTTPException(
            status_code=400,
            detail="Groq API Key is not configured. Please add it to your .env file."
        )
    return Groq(api_key=settings.GROQ_API_KEY)

# Helper function to get AsyncGroq client
def get_async_groq_client():
    if not settings.GROQ_API_KEY or settings.GROQ_API_KEY == "your_groq_api_key_here":
        raise HTTPException(
            status_code=400,
            detail="Groq API Key is not configured. Please add it to your .env file."
        )
    return AsyncGroq(api_key=settings.GROQ_API_KEY)

def call_llm_with_fallback(prompt_or_messages: Any, temperature: float = 0.3, response_format: Optional[dict] = None) -> str:
    """
    Calls the Groq LLM with automatic model fallback (llama-3.3-70b-versatile -> llama-3.1-8b-instant -> llama3-8b-8192).
    Also translates raw exceptions into friendly academic user messages.
    """
    client = get_groq_client()
    models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "llama3-8b-8192"]
    
    if isinstance(prompt_or_messages, str):
        messages = [{"role": "user", "content": prompt_or_messages}]
    else:
        messages = prompt_or_messages
        
    last_err = None
    import time
    for i, model in enumerate(models):
        try:
            logger.info(f"Calling LLM using model: {model} (Attempt {i+1})")
            kwargs = {
                "model": model,
                "messages": messages,
                "temperature": temperature
            }
            if response_format:
                kwargs["response_format"] = response_format
                
            response = client.chat.completions.create(**kwargs)
            return response.choices[0].message.content.strip()
        except Exception as e:
            last_err = e
            logger.warning(f"Model {model} failed: {e}. Retrying with fallback...")
            time.sleep(0.5)
            
    err_msg = str(last_err)
    if "429" in err_msg or "limit" in err_msg.lower():
        friendly = "AI service is temporarily busy. Retrying automatically..."
        status_code = 429
    elif "timeout" in err_msg.lower() or "deadline" in err_msg.lower():
        friendly = "The AI engine is taking longer than expected. Please try again in a moment."
        status_code = 504
    else:
        friendly = "The AI engine is temporarily busy. Please retry."
        status_code = 500
        
    raise HTTPException(status_code=status_code, detail=friendly)

async def call_async_llm_stream_with_fallback(messages: List[Dict[str, str]], temperature: float = 0.3):
    client = get_async_groq_client()
    models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "llama3-8b-8192"]
    import asyncio
    
    last_err = None
    for i, model in enumerate(models):
        try:
            logger.info(f"Calling Async LLM stream using model: {model} (Attempt {i+1})")
            completion = await client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
                temperature=temperature
            )
            return completion
        except Exception as e:
            last_err = e
            logger.warning(f"Async model {model} failed: {e}. Retrying with fallback...")
            await asyncio.sleep(0.5)
            
    err_msg = str(last_err)
    if "429" in err_msg or "limit" in err_msg.lower():
        friendly = "AI service is temporarily busy. Retrying automatically..."
    elif "timeout" in err_msg.lower() or "deadline" in err_msg.lower():
        friendly = "The AI engine is taking longer than expected. Please try again in a moment."
    else:
        friendly = "The AI engine is temporarily busy. Please retry."
        
    raise HTTPException(status_code=500, detail=friendly)

# Data models
class ChatRequest(BaseModel):
    message: str
    doc_filter: Optional[str] = None
    doc_filters: Optional[List[str]] = None
    explanation_mode: str = "intermediate" # beginner, intermediate, expert
    history: List[Dict[str, str]] = [] # [{"role": "user"/"assistant", "content": "..."}]
    top_k: int = 4
    chunk_size: int = 1000
    chunk_overlap: int = 200
    knowledge_mode: Optional[str] = "strict_rag" # strict_rag, hybrid, internet
    response_depth: Optional[str] = "standard" # concise, standard, detailed, expert

class ToolRequest(BaseModel):
    filename: Optional[str] = None
    filenames: Optional[List[str]] = None
    custom_prompt: Optional[str] = None
    notes_mode: Optional[str] = "detailed"
    explanation_mode: Optional[str] = "intermediate"
    knowledge_mode: Optional[str] = "strict_rag" # strict_rag, hybrid, internet
    response_depth: Optional[str] = "standard" # concise, standard, detailed, expert
    count: Optional[int] = None

class PlannerRequest(BaseModel):
    filenames: List[str]
    timeframe_weeks: int = 4
    daily_hours: float = 2.0

class ExportNotesRequest(BaseModel):
    markdown_content: str
    title: str = "AI Study Assistant Pro - Generated Notes"

class ChatMessage(BaseModel):
    role: str
    content: str
    timestamp: Optional[str] = None
    citations: Optional[List[str]] = None

class ExportChatRequest(BaseModel):
    messages: List[ChatMessage]
    session_title: str = "AI Study Assistant Pro - Chat Export"

class IndexTextRequest(BaseModel):
    filename: str
    text: str
    ocr_confidence: Optional[float] = 100.0
    reconstruction_confidence: Optional[float] = None
    semantic_quality_score: Optional[float] = None
    chunk_size: Optional[int] = 1000
    chunk_overlap: Optional[int] = 200
    session_id: Optional[str] = None

class OCRCorrectRequest(BaseModel):
    text: str

# Database file tracker metadata
DOCUMENT_METADATA_FILE = os.path.join(settings.UPLOAD_DIR, "docs_metadata.json")

def read_docs_metadata() -> Dict[str, Any]:
    if os.path.exists(DOCUMENT_METADATA_FILE):
        try:
            with open(DOCUMENT_METADATA_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def write_docs_metadata(metadata: Dict[str, Any]):
    with open(DOCUMENT_METADATA_FILE, "w") as f:
        json.dump(metadata, f, indent=4)

def detect_academic_intent(message: str) -> Optional[str]:
    msg = message.lower()
    
    # 16-mark questions / essay / descriptive questions / university exam / big answer
    long_form_keywords = [
        "16 mark", "16-mark", "essay", "descriptive", "theory", 
        "long answer", "university exam", "detailed answer", 
        "semester exam preparation", "big answer", "long-form"
    ]
    if any(k in msg for k in long_form_keywords):
        return "LONG_FORM_EXAM"
        
    # important questions
    important_keywords = ["important questions", "likely questions", "exam questions", "semester questions"]
    if any(k in msg for k in important_keywords):
        return "SEMESTER_QUESTIONS"
        
    # viva questions
    viva_keywords = ["viva", "oral interview", "oral question", "interview question"]
    if any(k in msg for k in viva_keywords):
        return "VIVA"
        
    # last minute revision
    revision_keywords = ["last minute revision", "revision notes", "quick revision", "revision study notes", "exam revision"]
    if any(k in msg for k in revision_keywords):
        return "REVISION"
        
    # teach me this topic
    teaching_keywords = ["teach me", "teaching mode", "lecture on", "explain to me", "explain like i'm 5", "teach this"]
    if any(k in msg for k in teaching_keywords):
        return "TEACHING"
        
    return None

def clean_query_for_rag(query: str) -> str:
    """
    Remove common academic instruction verbs, question starters, and mode phrases 
    to extract the core topic. This ensures that search_similarity performs 
    high-quality semantic searches on ChromaDB.
    """
    cleaned = query.lower()
    
    # 1. First, remove long specific instruction phrases
    phrases_to_remove = [
        "give me 16 mark questions with answers on",
        "give me 16 mark questions with answers",
        "give me 16 mark questions on",
        "give me 16 mark questions",
        "16 mark questions with answers on",
        "16 mark questions with answers",
        "16 mark questions on",
        "16 mark questions",
        "16 mark question on",
        "16 mark question",
        "explain in 16 marks on",
        "explain in 16 marks",
        "essay questions with answers on",
        "essay questions on",
        "essay question on",
        "essay questions",
        "essay question",
        "descriptive questions with answers on",
        "descriptive questions on",
        "descriptive question on",
        "descriptive questions",
        "descriptive question",
        "theory questions with answers on",
        "theory questions on",
        "theory question on",
        "theory questions",
        "theory question",
        "long answer questions on",
        "long answer question on",
        "long answer questions",
        "long answer question",
        "long answers on",
        "long answer on",
        "long answers",
        "long answer",
        "university exam questions on",
        "university exam question on",
        "university exam questions",
        "university exam question",
        "detailed answers on",
        "detailed answer on",
        "detailed answers",
        "detailed answer",
        "semester exam preparation on",
        "semester exam preparation",
        "big answer questions on",
        "big answer questions",
        "big answer question",
        "big answer on",
        "big answer",
        "important questions on",
        "important questions",
        "important question on",
        "important question",
        "likely questions on",
        "likely questions",
        "likely question on",
        "likely question",
        "exam questions on",
        "exam questions",
        "exam question on",
        "exam question",
        "semester questions on",
        "semester questions",
        "semester question on",
        "semester question",
        "viva questions on",
        "viva questions",
        "viva question on",
        "viva question",
        "oral interview questions on",
        "oral interview questions",
        "oral interview question on",
        "oral interview question",
        "last minute revision notes on",
        "last minute revision notes",
        "last minute revision on",
        "last minute revision",
        "revision notes on",
        "revision notes",
        "revision note on",
        "revision note",
        "quick revision notes on",
        "quick revision notes",
        "quick revision on",
        "quick revision",
        "teach me this topic",
        "teach me about",
        "teach me on",
        "teach me",
        "explain to me about",
        "explain to me on",
        "explain to me",
        "explain like i'm 5 about",
        "explain like i'm 5 on",
        "explain like i'm 5",
        "teaching mode on",
        "teaching mode",
        "lecture on",
        "lecture about",
        "tell me about",
        "tell me on"
    ]
    
    for p in phrases_to_remove:
        pattern = re.compile(r'\b' + re.escape(p) + r'\b', re.IGNORECASE)
        cleaned = pattern.sub("", cleaned)
        
    # 2. Remove common helper words, verbs, and question prefixes individually
    words_to_remove = [
        "give me", "give", "provide me with", "provide me", "provide", 
        "what is", "what are", "how does", "how to", "how", "why does", "why",
        "in 16 marks", "for 16 marks", "16 marks", "16 mark", "16-mark",
        "essay", "descriptive", "theory", "viva", "revision", "lecture",
        "questions with answers", "questions", "question", "answers", "answer",
        "detailed", "likely", "important", "semester", "exam", "university",
        "notes", "note", "teach", "explain", "about", "complete", "complete set of",
        "generate", "the", "for", "on", "to", "a", "an", "of", "with", "is", "are", "me"
    ]
    
    for w in words_to_remove:
        pattern = re.compile(r'\b' + re.escape(w) + r'\b', re.IGNORECASE)
        cleaned = pattern.sub("", cleaned)
        
    # Clean up excess whitespaces
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    
    # If the resulting cleaned string is empty or extremely short, fall back to original query
    if len(cleaned) < 3:
        return query
        
    # Clean up punctuation at the start/end of the query
    cleaned = re.sub(r'^[?,.\-:\s]+', '', cleaned)
    cleaned = re.sub(r'[?,.\-:\s]+$', '', cleaned)
    return cleaned.strip()

def get_academic_mode_instructions(mode: str) -> str:
    if mode == "LONG_FORM_EXAM":
        return (
            "YOU ARE CURRENTLY IN LONG_FORM_EXAM_MODE.\n"
            "Your task is to generate FULL-LENGTH DESCRIPTIVE QUESTIONS, UNIVERSITY EXAM STYLE QUESTIONS, and DETAILED THEORY ANSWERS based on the retrieved context.\n"
            "CRITICAL RULES:\n"
            "1. DO NOT generate MCQs (multiple-choice questions), one-line answers, short answers, fragmented bullet lists without detailed text, or quiz-style responses.\n"
            "2. Generate full-length, comprehensive, essay-style answers that are detailed and lengthy enough for a student to write in a real university semester exam.\n"
            "3. Format each descriptive answer with the following structure:\n"
            "   - **Introduction**: Briefly introduce the topic or concept, describing what it is and its significance.\n"
            "   - **Definition**: Provide a formal, precise academic definition of the core terms.\n"
            "   - **Detailed Explanation**: Break down the concept into sub-components, stages, phases, or layers in deep detail, explaining each thoroughly (at least a paragraph per sub-component/phase).\n"
            "   - **Real-world Examples / Applications**: Provide concrete real-world use cases or scenarios illustrating this concept.\n"
            "   - **Advantages / Benefits**: Highlight the advantages, pros, or key benefits of using or implementing this concept.\n"
            "   - **Conclusion**: Conclude with a summary of the concept and its key takeaways.\n"
            "4. Ensure your writing is highly detailed, academic, and professional, and that it reads like an official model answer key."
        )
    elif mode == "SEMESTER_QUESTIONS":
        return (
            "YOU ARE CURRENTLY IN SEMESTER_QUESTIONS_MODE.\n"
            "Your task is to generate likely, highly-relevant semester exam questions based on the retrieved context, followed by model answers.\n"
            "CRITICAL RULES:\n"
            "1. Focus on standard university-style questions: generate a mix of 16-mark detailed theory questions and 4/8-mark descriptive questions.\n"
            "2. For each question generated, provide a complete, well-structured, and highly detailed model answer.\n"
            "3. The answers should contain clear headings, subheadings, explanations, and key takeaways.\n"
            "4. Format the answers to be immediately usable for semester exam preparation."
        )
    elif mode == "VIVA":
        return (
            "YOU ARE CURRENTLY IN VIVA_MODE.\n"
            "Your task is to generate realistic, common oral examination / viva questions and crisp model answers based on the retrieved context.\n"
            "CRITICAL RULES:\n"
            "1. Format your response as a list of Question and Answer pairs (e.g., Q1: ..., A1: ...).\n"
            "2. Keep the answers concise but technically accurate, written in a conversational yet professional tone (how a student should answer an interviewer verbally).\n"
            "3. Include brief follow-up explanations, definitions, and logic for each answer."
        )
    elif mode == "REVISION":
        return (
            "YOU ARE CURRENTLY IN REVISION_MODE.\n"
            "Your task is to generate clean, high-yield, concise revision notes based on the retrieved context.\n"
            "CRITICAL RULES:\n"
            "1. Focus on quick-review summaries: compile important definitions, key points, core formulas, and critical concepts.\n"
            "2. Use a highly structured bullet-point layout with bold headers.\n"
            "3. Make it extremely easy to scan and read right before entering the exam hall."
        )
    elif mode == "TEACHING":
        return (
            "YOU ARE CURRENTLY IN TEACHING_MODE.\n"
            "Your task is to teach/explain the topic to the student in a clear, highly educational, and friendly tone.\n"
            "CRITICAL RULES:\n"
            "1. Act as a patient, encouraging university professor/tutor.\n"
            "2. Explain complex topics using intuitive, everyday analogies and step-by-step logic.\n"
            "3. Break down advanced technical terms before building up to deep details.\n"
            "4. Include interactive reflection questions or thought experiments to help the student grasp the concept."
        )
    return ""

def configure_knowledge_mode(
    knowledge_mode: str, 
    context_str: str, 
    base_prompt_instruction: str, 
    citations_list: List[Dict[str, Any]] = None,
    academic_mode: Optional[str] = None
):
    """
    Returns (system_prompt, temperature, source_indicator, citations_footer) based on knowledge mode and academic mode.
    Note: Internet and Hybrid modes are completely removed. Always forces strict_rag.
    """
    temp = 0.3 if academic_mode else 0.05
    citations_footer = ""
    
    # Generate citations footer for STRICT RAG mode
    if citations_list:
        unique_sources = []
        for c in citations_list:
            src = c.get("metadata", {}).get("source", "Unknown Document")
            pg = c.get("metadata", {}).get("page", None)
            ocr_flag = c.get("metadata", {}).get("ocr_flag", False)
            
            if ocr_flag:
                src_label = f"OCR Notes Page {pg}" if pg else "OCR Notes"
            else:
                src_label = f"{src} (Page {pg})" if pg else src
                
            if src_label not in unique_sources:
                unique_sources.append(src_label)
                
        if unique_sources:
            citations_footer = "\n\n**Sources:**\n" + "\n".join([f"- {s}" for s in unique_sources])

    indicator = ""
    
    if academic_mode:
        academic_instr = get_academic_mode_instructions(academic_mode)
        system_prompt = (
            "You are an intelligent, intent-aware university study assistant. Your goal is to answer the user's question or generate content by dynamically adapting to their academic intent.\n"
            "RULES FOR GROUNDED ACADEMIC GENERATION:\n"
            "1. Ground all core facts, technical concepts, theories, and formulas in the provided RETRIEVED STUDENT DOCS CONTEXT. Do not invent facts that contradict or are entirely absent from the context.\n"
            "2. You are encouraged to structure, elaborate, explain, and synthesize the context. You may add standard academic structuring (e.g. Introduction, Definition, detailed explanations, real-world examples, advantages, and Conclusion) where appropriate.\n"
            "3. Do NOT write inline citations, source tags, document names, or page numbers (like [Filename.pdf, Page X]) inside the generated text. Keep the text clean and natural.\n"
            "4. If the provided context is completely empty or does not contain any relevant information about the topic at all, you must respond EXACTLY with:\n"
            "   \"The selected material does not contain enough information to answer this question.\"\n"
            "   Do not add any preamble or greeting.\n\n"
            f"Academic Mode Instructions:\n{academic_instr}\n\n"
            f"Base Instructions:\n{base_prompt_instruction}\n\n"
            f"--- RETRIEVED STUDENT DOCS CONTEXT ---\n{context_str or 'No context available.'}\n---"
        )
    else:
        system_prompt = (
            "You are a strict, grounded academic QA system. Your goal is to answer the user's question or generate content using ONLY the provided document context.\n"
            "RULES FOR STRICT RAG MODE:\n"
            "1. Answer the question or generate content using ONLY facts, concepts, and formulas explicitly mentioned in the provided context.\n"
            "2. Do NOT use any pre-trained world knowledge or external assumptions. If it's not in the context, do not explain or assume it.\n"
            "3. Do NOT add filler explanations, outside examples, or external context.\n"
            "4. Every statement you make must be directly backed by the provided context. Do NOT write inline citations, source tags, document names, or page numbers (like [Filename.pdf, Page X]) inside the generated text. Keep the text clean, natural, and formatted like polished study notes.\n"
            "5. If the provided context does not contain enough information to answer the user's question or generate the requested content, you must respond EXACTLY with:\n"
            "   \"The selected material does not contain enough information to answer this question.\"\n"
            "   Do not add any preamble, greeting, or explanation.\n\n"
            f"Base Instructions:\n{base_prompt_instruction}\n\n"
            f"--- RETRIEVED STUDENT DOCS CONTEXT ---\n{context_str or 'No context available.'}\n---"
        )
        
    return system_prompt, temp, indicator, citations_footer

def get_depth_instruction(response_depth: str) -> str:
    if not response_depth:
        return ""
        
    if response_depth == "concise":
        return (
            "RESPONSE DEPTH REQUIREMENT: Provide a highly concise, direct, and brief response. "
            "Avoid elaborate explanations, long analogies, or step-by-step proofs unless explicitly asked. "
            "Focus on immediate direct answers (max 1-2 short paragraphs or brief bullets)."
        )
    elif response_depth == "detailed":
        return (
            "RESPONSE DEPTH REQUIREMENT: Provide a highly detailed, comprehensive, and exhaustive explanation. "
            "Structure your output professionally using clear headings, subheadings, and bullet lists. "
            "You MUST explain the concepts deeply, include concrete illustrative examples, describe real-world use-cases, "
            "provide everyday analogies, suggest memory tricks/mnemonics, highlight key takeaways, and list likely exam/interview review questions. "
            "The generated content should serve as textbook-level exam preparation material. Avoid generic summaries or brief responses."
        )
    elif response_depth == "expert":
        return (
            "RESPONSE DEPTH REQUIREMENT: Provide an extremely advanced, expert-level academic response. "
            "Do not oversimplify or omit complex mechanisms. "
            "Provide deep theoretical insights, step-by-step mathematical proofs or derivations (rendered in LaTeX), "
            "structural architectural block diagrams (using ASCII or Mermaid syntax if applicable), detailed edge cases, "
            "limitations of the methods, and comprehensive academic review questions with solutions. "
            "Your output must feel like a premium textbook chapter or academic reference paper."
        )
    else: # standard (default)
        return (
            "RESPONSE DEPTH REQUIREMENT: Provide a standard, balanced academic response. "
            "Explain concepts clearly, outline main terms, and provide simple definitions and examples in a clean, structured layout."
        )

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "groq_configured": bool(settings.GROQ_API_KEY and settings.GROQ_API_KEY != "your_groq_api_key_here")}

# Cache EasyOCR reader on module level
_easyocr_reader = None

def get_easyocr_reader():
    global _easyocr_reader
    if _easyocr_reader is None:
        logger.info("Initializing EasyOCR English Reader...")
        _easyocr_reader = easyocr.Reader(['en'])
    return _easyocr_reader

def preprocess_image_for_ocr(image_bytes: bytes, pass_num: int = 1) -> np.ndarray:
    """
    Applies advanced image preprocessing techniques using OpenCV to optimize OCR accuracy.
    pass_num: 1 (standard preprocessing) or 2 (alternative thresholding for secondary pass).
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image.")
        
    h, w = img.shape[:2]
    
    # 1. Resolution Upscaling: If image is small, upscale it to improve OCR character definition
    if min(h, w) < 1500:
        scale_factor = 2000.0 / min(h, w)
        img = cv2.resize(img, (int(w * scale_factor), int(h * scale_factor)), interpolation=cv2.INTER_CUBIC)
        h, w = img.shape[:2]

    # 2. Grayscale conversion
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # 3. Shadow removal & brightness normalization
    dilated = cv2.dilate(gray, np.ones((7,7), np.uint8))
    bg_img = cv2.medianBlur(dilated, 21)
    diff = 255 - cv2.absdiff(gray, bg_img)
    normalized = cv2.normalize(diff, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX, dtype=cv2.CV_8U)
    
    # 4. Deskew / Tilt Correction
    coords = np.column_stack(np.where(normalized < 150))
    if coords.size > 0:
        angle = cv2.minAreaRect(coords)[-1]
        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle
        if 0.5 < abs(angle) < 20:
            M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
            normalized = cv2.warpAffine(normalized, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)

    # 5. Contrast enhancement (CLAHE)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(normalized)

    # 6. Denoising / Noise Removal
    denoised = cv2.fastNlMeansDenoising(enhanced, None, h=10, templateWindowSize=7, searchWindowSize=21)

    # 7. Adaptive Thresholding / Binarization
    if pass_num == 1:
        thresh = cv2.adaptiveThreshold(
            denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
        )
    else:
        _, thresh = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
    # 8. Sharpening filter
    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
    sharpened = cv2.filter2D(thresh, -1, kernel)
    
    return sharpened

def extract_text_from_image(image_bytes: bytes) -> tuple:
    """
    Runs multi-pass OCR on image bytes using EasyOCR (primary) and Tesseract (fallback).
    Preprocesses with OpenCV and returns (text, average_confidence).
    """
    reader = get_easyocr_reader()
    
    best_text = ""
    best_conf = 0.0
    best_engine = "None"
    
    # Try Pass 1 & Pass 2 with EasyOCR
    for pass_num in (1, 2):
        try:
            processed = preprocess_image_for_ocr(image_bytes, pass_num=pass_num)
            
            # EasyOCR expects a numpy array or file
            results = reader.readtext(processed)
            if results:
                texts = [res[1] for res in results]
                confidences = [res[2] for res in results]
                
                easy_text = "\n".join(texts)
                # Convert 0-1 float to 0-100 percentage
                easy_conf = (sum(confidences) / len(confidences)) * 100.0 if confidences else 0.0
                
                if easy_conf > best_conf:
                    best_text = easy_text
                    best_conf = easy_conf
                    best_engine = f"EasyOCR Pass {pass_num}"
        except Exception as e:
            logger.error(f"EasyOCR error in pass {pass_num}: {e}")
            
    # Try Tesseract fallback pass
    try:
        processed_tess = preprocess_image_for_ocr(image_bytes, pass_num=1)
        tess_text = pytesseract.image_to_string(processed_tess)
        
        tess_data = pytesseract.image_to_data(processed_tess, output_type=pytesseract.Output.DICT)
        tess_confidences = [int(c) for c in tess_data['conf'] if c != '-1' and c != -1]
        tess_conf = sum(tess_confidences) / len(tess_confidences) if tess_confidences else 0.0
        
        # If Tesseract confidence is superior or EasyOCR yielded empty text, use it
        if tess_conf > best_conf and len(tess_text.strip()) > 10:
            best_text = tess_text
            best_conf = tess_conf
            best_engine = "Tesseract Fallback"
    except Exception as e:
        logger.error(f"Tesseract fallback error: {e}")
        
    # Absolute raw fallback if text is empty
    if not best_text.strip():
        try:
            img = Image.open(io.BytesIO(image_bytes))
            best_text = pytesseract.image_to_string(img)
            best_conf = 50.0
            best_engine = "Tesseract Raw Fallback"
        except Exception:
            pass
            
    logger.info(f"OCR Selection: {best_engine} with confidence {best_conf:.2f}%")
    return best_text.strip(), best_conf

def is_pdf_scanned(file_path: str) -> bool:
    try:
        doc = fitz.open(file_path)
        text_length = 0
        for page in doc:
            text = page.get_text()
            if text:
                text_length += len(text.strip())
            if text_length >= 50:
                return False
        return True
    except Exception as e:
        logger.error(f"Error checking if PDF is scanned: {e}")
        return True

def process_and_ocr_pdf(file_path: str) -> tuple:
    """
    Extracts text page-by-page from scanned PDF by rendering pages to high-res images and running OCR.
    Returns (full_text, average_confidence, page_count).
    """
    try:
        doc = fitz.open(file_path)
        total_text = []
        total_conf = []
        page_count = len(doc)
        
        for page_idx in range(page_count):
            page = doc.load_page(page_idx)
            zoom = 2.0
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat)
            
            img_data = pix.tobytes("png")
            page_text, page_conf = extract_text_from_image(img_data)
            
            total_text.append(f"--- Page {page_idx + 1} ---\n{page_text}")
            total_conf.append(page_conf)
            
        full_text = "\n\n".join(total_text)
        avg_confidence = sum(total_conf) / len(total_conf) if total_conf else 0.0
        return full_text, avg_confidence, page_count
    except Exception as e:
        logger.error(f"PDF OCR error: {e}")
        return "", 0.0, 0

@app.post("/api/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    chunk_size: int = Form(1000),
    chunk_overlap: int = Form(200),
    session_id: Optional[str] = Form(None)
):
    results = []
    metadata = read_docs_metadata()

    for file in files:
        filename = file.filename
        lower_name = filename.lower()
        is_pdf = lower_name.endswith('.pdf')
        is_image = lower_name.endswith(('.png', '.jpg', '.jpeg'))

        if not (is_pdf or is_image):
            results.append({
                "filename": filename,
                "status": "error",
                "message": "Unsupported file format. Only PDFs and images (.png, .jpg, .jpeg) are supported."
            })
            continue

        file_path = os.path.join(settings.UPLOAD_DIR, filename)
        
        # Save file to disk
        try:
            with open(file_path, "wb") as f:
                content = await file.read()
                f.write(content)
                file_size = len(content)
        except Exception as e:
            results.append({
                "filename": filename,
                "status": "error",
                "message": f"Failed to save file: {str(e)}"
            })
            continue

        if is_image:
            try:
                text, confidence = extract_text_from_image(content)
                analysis = batch_analyze_and_reconstruct_ocr(text, confidence)
                results.append({
                    "filename": filename,
                    "status": "ocr_preview_required",
                    "text": text,
                    "corrected_text": analysis.get("corrected_text", text),
                    "confidence": confidence,
                    "reconstruction_confidence": analysis.get("reconstruction_confidence", 75),
                    "semantic_quality_score": analysis.get("semantic_quality_score", 70),
                    "pages": 1,
                    "size_bytes": file_size
                })
            except Exception as e:
                results.append({
                    "filename": filename,
                    "status": "error",
                    "message": f"OCR extraction failed: {str(e)}"
                })
                if os.path.exists(file_path):
                    os.remove(file_path)
        else: # is_pdf
            if is_pdf_scanned(file_path):
                try:
                    text, confidence, page_count = process_and_ocr_pdf(file_path)
                    analysis = batch_analyze_and_reconstruct_ocr(text, confidence)
                    results.append({
                        "filename": filename,
                        "status": "ocr_preview_required",
                        "text": text,
                        "corrected_text": analysis.get("corrected_text", text),
                        "confidence": confidence,
                        "reconstruction_confidence": analysis.get("reconstruction_confidence", 75),
                        "semantic_quality_score": analysis.get("semantic_quality_score", 70),
                        "pages": page_count,
                        "size_bytes": file_size
                    })
                except Exception as e:
                    results.append({
                        "filename": filename,
                        "status": "error",
                        "message": f"OCR extraction failed: {str(e)}"
                    })
                    if os.path.exists(file_path):
                        os.remove(file_path)
            else:
                try:
                    doc_fitz = fitz.open(file_path)
                    pages_text = []
                    for page_idx in range(len(doc_fitz)):
                        page = doc_fitz.load_page(page_idx)
                        page_text = page.get_text() or ""
                        pages_text.append(f"--- Page {page_idx + 1} ---\n{page_text}")
                    full_text = "\n\n".join(pages_text)
                    page_count = len(doc_fitz)
                    
                    index_res = process_and_index_document_text(
                        file_path=file_path,
                        filename=filename,
                        raw_text=full_text,
                        ocr_confidence=100.0,
                        chunk_size=chunk_size,
                        chunk_overlap=chunk_overlap,
                        session_id=session_id,
                        upload_type="typed_pdf",
                        source_type="pdf",
                        ocr_flag=False
                    )
                    
                    if index_res["status"] == "success":
                        metadata[filename] = {
                            "filename": filename,
                            "size_bytes": file_size,
                            "pages": index_res["pages_count"],
                            "chunks": index_res["chunks_count"],
                            "ocr_confidence": 100.0,
                            "reconstruction_confidence": index_res["reconstruction_confidence"],
                            "semantic_quality_score": index_res["semantic_quality_score"],
                            "session_id": session_id or "global",
                            "upload_type": "typed_pdf",
                            "source_type": "pdf",
                            "ocr_flag": False
                        }
                        results.append({
                            "filename": filename,
                            "status": "success",
                            "pages": index_res["pages_count"],
                            "chunks": index_res["chunks_count"]
                        })
                    else:
                        results.append({
                            "filename": filename,
                            "status": "error",
                            "message": index_res["message"]
                        })
                except Exception as e:
                    results.append({
                        "filename": filename,
                        "status": "error",
                        "message": f"Indexing error: {str(e)}"
                    })
                    if os.path.exists(file_path):
                        os.remove(file_path)

    write_docs_metadata(metadata)
    return {"results": results}

def analyze_and_reconstruct_ocr(raw_text: str, ocr_confidence: float = 100.0) -> dict:
    """
    Calls the Groq LLM to clean up the raw OCR text, reconstruct concepts, extract keywords, 
    summaries, definitions, and likely exam questions, and organize it into rich semantic sections.
    """
    client = get_groq_client()
    
    prompt = (
        r"You are an advanced educational document parser and semantic study note analyzer."
        "\n\n"
        r"Your task is to analyze the following raw OCR text extracted from handwritten notes, reconstruct it into clear, coherent, academically complete study notes, and organize it into logical, enriched semantic sections."
        "\n\n"
        r"Analyze the text and output a JSON object matching this schema:"
        "\n"
        r"{"
        "\n"
        r"  \"corrected_text\": \"The full combined cleaned and reconstructed note text, incorporating math formulas in LaTeX ($...$ or $$...$$), headings, proper paragraphs, and list formatting.\","
        "\n"
        r"  \"reconstruction_confidence\": 85, // An integer from 0 to 100 representing how confident you are in the accuracy of the repaired spelling, layout, and structure."
        "\n"
        r"  \"semantic_quality_score\": 90, // An integer from 0 to 100 representing the academic quality, depth, and coherence of the notes contents."
        "\n"
        r"  \"sections\": ["
        "\n"
        r"    {"
        "\n"
        r"      \"heading\": \"Section Title\","
        "\n"
        r"      \"section_type\": \"definition\", // MUST be one of: 'definition', 'formula', 'concept', 'example', 'explanation', 'subtopic', 'heading', 'derivation'"
        "\n"
        r"      \"original_ocr\": \"Original raw OCR text segment corresponding to this section.\","
        "\n"
        r"      \"reconstructed_content\": \"Cleaned, corrected, and academically expanded explanation of this specific section. Formulate complete sentences, fix spacing/grammar, and add academic context.\","
        "\n"
        r"      \"summary\": \"A concise 1-2 sentence contextual summary of this section.\","
        "\n"
        r"      \"concepts\": [\"Concept Name\"], // Key academic concepts discussed in this section."
        "\n"
        r"      \"keywords\": [\"keyword\"], // 5-10 academic keywords or tags for this section."
        "\n"
        r"      \"glossary\": {\"term\": \"definition\"}, // Dictionary mapping key terms to definitions found or explained in this section. Empty object if none."
        "\n"
        r"      \"exam_questions\": [\"Likely exam question?\"], // 2-3 likely exam or review questions based on this section."
        "\n"
        r"      \"formulas\": [\"$E = mc^2$\"] // Any math/scientific formulas found in this section, formatted in LaTeX. Empty list if none."
        "\n"
        r"    }"
        "\n"
        r"  ]"
        "\n"
        r"}"
        "\n\n"
        r"Guidelines for Section Classification:"
        "\n"
        r"- 'definition': For sections defining key academic terminology, vocabulary, or glossary terms."
        "\n"
        r"- 'formula': For sections showing mathematical equations, calculus relations, chemistry equations, or physics constants."
        "\n"
        r"- 'derivation': For step-by-step mathematical proofs or equation derivations."
        "\n"
        r"- 'concept': For core academic concepts, theories, and ideas."
        "\n"
        r"- 'example': For practice problems, examples, or applications of a concept."
        "\n"
        r"- 'explanation': For descriptive text, analogies, descriptions, and summaries of a topic."
        "\n"
        r"- 'subtopic' or 'heading': For title blocks, headings, or structural dividers."
        "\n\n"
        r"Rules & OCR Quality Control:"
        "\n"
        r"1. Repair all raw OCR typos, join broken words, clean spacing, and isolate equations."
        "\n"
        r"2. OCR CLEANING & TOKEN VALIDATION: Identify and filter out OCR noise, random non-alphanumeric characters, and garbage tokens (e.g. 'xxxx', '||||', 'gunk', 'tip sek', 'sup count')."
        "\n"
        r"3. ACADEMIC TERM CORRECTION: DO NOT explain garbage tokens literally. Instead, perform fuzzy matching and contextual repair. Compare fragmented or misspelled words against known academic, scientific, and mathematical vocabulary. Infer the correct academic term based on the surrounding context (e.g., repair 'Sup Count' -> 'Support Count', 'Tip Sek' -> 'Itemset' or 'FP-Tree' in data mining context, 'Deriv' -> 'Derivative' in calculus context)."
        "\n"
        r"4. STRICT QUALITY CONTROL FOR LOW-CONFIDENCE SECTIONS: If a portion of the text is completely garbled, illegible, or unreadable, DO NOT make up fake concepts or hallucinate. Instead, in the 'reconstructed_content', explicitly note: '[Section partially unreadable due to handwriting quality / low OCR confidence]' and follow this warning with your best effort contextual reconstruction of the likely intended topic, explaining it as a probable interpretation rather than a certainty."
        "\n"
        r"5. Expand fragmented sentences into full, academically rich, professionally structured explanations. The resulting notes should feel like they were written by an expert teacher/study guide."
        "\n"
        r"6. Do NOT hallucinate or introduce new, unrelated academic topics that are not mentioned or implied in the raw OCR text. Reconstruct and expand ONLY the specific topics, terms, and context present in the input text."
        "\n"
        r"7. Return ONLY the raw JSON object conforming strictly to the format. Do not wrap in ```json or add any other text."
        "\n\n"
        r"--- RAW OCR TEXT ---"
        "\n"
        + raw_text
    )
    
    try:
        response_str = call_llm_with_fallback(
            prompt_or_messages=prompt,
            temperature=0.1,
            response_format={"type": "json_object"}
        )
        result_json = json.loads(response_str)
        return result_json
    except Exception as e:
        logger.error(f"Error analyzing OCR text: {e}")
        # Return fallback structured representation
        return {
            "corrected_text": raw_text,
            "reconstruction_confidence": 70,
            "semantic_quality_score": 60,
            "sections": [
                {
                    "heading": "Reconstructed Document Section",
                    "section_type": "explanation",
                    "original_ocr": raw_text,
                    "reconstructed_content": raw_text,
                    "summary": "Extracted text content from document.",
                    "concepts": ["General Study Content"],
                    "keywords": ["study", "notes"],
                    "glossary": {},
                    "exam_questions": [],
                    "formulas": []
                }
            ]
        }

def split_text_by_pages(text: str) -> List[Dict[str, Any]]:
    """
    Parses a text containing page markers and returns a list of dictionaries with text and page number.
    """
    pages_data = []
    matches = list(re.finditer(r'---\s*Page\s+(\d+)\s*---', text))
    
    if not matches:
        pages_data.append({"text": text, "page": 1})
    else:
        # text before first match
        first_start = matches[0].start()
        pre_text = text[:first_start].strip()
        if pre_text:
            pages_data.append({"text": pre_text, "page": 1})
        
        for i in range(len(matches)):
            curr_match = matches[i]
            page_num = int(curr_match.group(1))
            start_idx = curr_match.end()
            end_idx = matches[i+1].start() if i + 1 < len(matches) else len(text)
            page_text = text[start_idx:end_idx].strip()
            pages_data.append({"text": page_text, "page": page_num})
            
    return pages_data

def batch_analyze_and_reconstruct_ocr(raw_text: str, ocr_confidence: float = 100.0) -> dict:
    """
    Helper that splits raw text into batches of up to 3 pages, calls analyze_and_reconstruct_ocr
    on each batch, and combines the resulting corrected text, sections, and average confidences.
    """
    pages_data = split_text_by_pages(raw_text)
    if not pages_data:
        return {
            "corrected_text": raw_text,
            "reconstruction_confidence": 70,
            "semantic_quality_score": 60,
            "sections": []
        }
        
    combined_corrected_parts = []
    combined_sections = []
    total_recon = 0
    total_sem = 0
    batch_count = 0
    
    # Process pages in batches of 3
    for i in range(0, len(pages_data), 3):
        batch = pages_data[i:i+3]
        batch_text_list = []
        for p in batch:
            batch_text_list.append(f"--- Page {p['page']} ---\n{p['text']}")
        batch_text = "\n\n".join(batch_text_list)
        
        analysis = analyze_and_reconstruct_ocr(batch_text, ocr_confidence)
        
        combined_corrected_parts.append(analysis.get("corrected_text", ""))
        combined_sections.extend(analysis.get("sections", []))
        total_recon += analysis.get("reconstruction_confidence", 80)
        total_sem += analysis.get("semantic_quality_score", 80)
        batch_count += 1
        
    avg_recon = total_recon / batch_count if batch_count else 80
    avg_sem = total_sem / batch_count if batch_count else 80
    
    return {
        "corrected_text": "\n\n".join(combined_corrected_parts),
        "reconstruction_confidence": int(avg_recon),
        "semantic_quality_score": int(avg_sem),
        "sections": combined_sections
    }

def process_and_index_document_text(
    file_path: str,
    filename: str,
    raw_text: str,
    ocr_confidence: float = 100.0,
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
    session_id: str = None,
    upload_type: str = "typed_pdf",
    source_type: str = "pdf",
    ocr_flag: bool = False
) -> Dict[str, Any]:
    """
    Extracts text, runs semantic note reconstruction sequentially (batched by 3 pages),
    and indexes the reconstructed sections using rag_service.index_structured_text.
    """
    try:
        # Run batch analysis
        analysis = batch_analyze_and_reconstruct_ocr(raw_text, ocr_confidence)
        
        # Index in ChromaDB
        index_res = rag_service.index_structured_text(
            filename=filename,
            text=raw_text,
            analysis=analysis,
            ocr_confidence=ocr_confidence,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            session_id=session_id,
            upload_type=upload_type,
            source_type=source_type,
            ocr_flag=ocr_flag
        )
        
        if index_res["status"] == "success":
            return {
                "status": "success",
                "chunks_count": index_res["chunks_count"],
                "pages_count": index_res["pages_count"],
                "reconstruction_confidence": analysis.get("reconstruction_confidence", 80),
                "semantic_quality_score": analysis.get("semantic_quality_score", 80)
            }
        else:
            return {"status": "error", "message": index_res.get("message", "Failed to index structured text")}
    except Exception as e:
        logger.error(f"Error in process_and_index_document_text: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/api/index-text")
def index_text_endpoint(req: IndexTextRequest):
    metadata = read_docs_metadata()
    filename = req.filename
    file_path = os.path.join(settings.UPLOAD_DIR, filename)

    try:
        # Run semantic note structure analysis
        analysis = batch_analyze_and_reconstruct_ocr(req.text, req.ocr_confidence or 100.0)
        
        lower_name = filename.lower()
        is_pdf = lower_name.endswith('.pdf')
        upload_type = "scanned_pdf" if is_pdf else "image"
        source_type = "pdf" if is_pdf else "image"
        ocr_flag = True

        index_res = rag_service.index_structured_text(
            filename=filename,
            text=req.text,
            analysis=analysis,
            ocr_confidence=req.ocr_confidence or 100.0,
            chunk_size=req.chunk_size,
            chunk_overlap=req.chunk_overlap,
            session_id=req.session_id,
            upload_type=upload_type,
            source_type=source_type,
            ocr_flag=ocr_flag
        )
        
        if index_res["status"] == "success":
            file_size = os.path.getsize(file_path) if os.path.exists(file_path) else len(req.text)
            metadata[filename] = {
                "filename": filename,
                "size_bytes": file_size,
                "pages": index_res["pages_count"],
                "chunks": index_res["chunks_count"],
                "ocr_confidence": req.ocr_confidence or 100.0,
                "reconstruction_confidence": analysis.get("reconstruction_confidence", 80),
                "semantic_quality_score": analysis.get("semantic_quality_score", 80),
                "session_id": req.session_id or "global",
                "upload_type": upload_type,
                "source_type": source_type,
                "ocr_flag": ocr_flag
            }
            write_docs_metadata(metadata)
            return {
                "status": "success",
                "filename": filename,
                "pages": index_res["pages_count"],
                "chunks": index_res["chunks_count"]
            }
        else:
            raise HTTPException(status_code=400, detail=index_res["message"])
    except Exception as e:
        logger.error(f"Error indexing text: {e}")
        raise HTTPException(status_code=500, detail=f"Indexing error: {str(e)}")

@app.post("/api/ocr/correct")
def correct_ocr_text_endpoint(req: OCRCorrectRequest):
    """
    Applies the AI OCR Correction layer using the Groq LLM.
    Fixes spelling errors, missing letters, and spacing, while retaining original structure and headings.
    """
    client = get_groq_client()
    raw_text = req.text
    
    if not raw_text.strip():
        return {"corrected_text": ""}

    prompt = (
        r"You are an expert academic text reconstructor and mathematical formula repair specialist. "
        r"Your task is to clean up, repair, and format the following raw OCR text extracted from handwritten study notes, especially fixing mathematical formulas."
        "\n\n"
        r"Guidelines & OCR Denoising:"
        "\n"
        r"1. Fix spelling mistakes, missing letters, and obvious OCR typos (e.g. 'cliar' -> 'clear', 'rnath' -> 'math')."
        "\n"
        r"2. OCR NOISE FILTERING & TOKEN VALIDATION: Identify and filter out OCR noise, random non-alphanumeric characters, and garbage tokens (e.g. 'xxxx', '||||', 'gunk', 'tip sek', 'sup count')."
        "\n"
        r"3. ACADEMIC TERM CORRECTION: DO NOT explain garbage tokens literally. Instead, perform fuzzy matching and contextual repair. Compare fragmented or misspelled words against known academic, scientific, and mathematical vocabulary. Infer the correct academic term based on the surrounding context (e.g., repair 'Sup Count' -> 'Support Count', 'Tip Sek' -> 'Itemset' or 'FP-Tree' in data mining context, 'Deriv' -> 'Derivative' in calculus context)."
        "\n"
        r"4. STRICT QUALITY CONTROL: If a portion of the text is completely garbled, illegible, or unreadable, explicitly insert: '[Section partially unreadable due to handwriting quality / low OCR confidence]' and make your best effort contextual reconstruction of the likely intended topic."
        "\n"
        r"5. Correctly rejoin words split across lines or broken words (e.g. 'un- der- stand' -> 'understand')."
        "\n"
        r"6. Reconstruct coherent paragraphs, maintaining the original document structure."
        "\n"
        r"7. Keep all academic headings, formulas, and bullet points intact. Do not summarize or remove key study details."
        "\n"
        r"8. Maintain pagination indicators like '--- Page X ---' exactly as they are."
        "\n"
        r"7. MATHEMATICAL FORMULAS & SCIENTIFIC SYMBOLS RECONSTRUCTION:"
        "\n"
        r"   - Detect mathematical, physics, chemistry, and statistical equations/symbols in the raw OCR."
        "\n"
        r"   - Reconstruct malformed, incomplete, or broken equations into valid, standard LaTeX notation."
        "\n"
        r"   - Correctly translate raw OCR approximations into standard LaTeX commands (e.g., convert raw text fractions, integrals, sums, subscripts/superscripts, derivatives, limits, and matrices to proper LaTeX)."
        "\n"
        r"   - Format inline equations/symbols (like variables, Greek letters, constants) using single dollar signs, e.g., $E = mc^2$ or $\theta = \pi/2$."
        "\n"
        r"   - Format display/block equations (like multi-line math, aligned equations, matrices, complex calculus integrals, and summations) on their own lines wrapped in double dollar signs. For example:"
        "\n"
        r"     $$"
        "\n"
        r"     P(A|B) = \frac{P(A \cap B)}{P(B)}"
        "\n"
        r"     $$"
        "\n"
        r"   - Make sure all Greek letters, symbols, subscripts, and superscripts are properly formatted in LaTeX and enclosed in $ or $$."
        "\n"
        r"8. Return ONLY the repaired and formatted text. Do not add any introductory, conversational, or meta text."
        "\n\n"
        "--- RAW OCR TEXT ---\n"
        + raw_text
    )

    try:
        corrected_text = call_llm_with_fallback(
            prompt_or_messages=prompt,
            temperature=0.1
        )
        return {"corrected_text": corrected_text}
    except Exception as e:
        logger.error(f"Groq OCR correction error: {e}")
        raise HTTPException(status_code=500, detail=f"LLM correction failed: {str(e)}")

@app.get("/api/documents")
def list_documents():
    metadata = read_docs_metadata()
    return list(metadata.values())

@app.delete("/api/documents/{filename}")
def delete_document(filename: str):
    metadata = read_docs_metadata()
    if filename not in metadata:
        raise HTTPException(status_code=404, detail="Document not found.")

    # Remove from disk
    file_path = os.path.join(settings.UPLOAD_DIR, filename)
    if os.path.exists(file_path):
        os.remove(file_path)

    # Remove from Chroma
    rag_service.delete_document(filename)

    # Update metadata
    del metadata[filename]
    write_docs_metadata(metadata)

    return {"status": "success", "message": f"Deleted document '{filename}' successfully."}

@app.post("/api/documents/clear")
def clear_all_documents():
    # Clear directory uploads
    for file in os.listdir(settings.UPLOAD_DIR):
        if file != "docs_metadata.json":
            file_path = os.path.join(settings.UPLOAD_DIR, file)
            if os.path.isfile(file_path):
                os.remove(file_path)
    
    # Reset vector store
    rag_service.clear_all()

    # Clear metadata
    write_docs_metadata({})
    return {"status": "success", "message": "All documents cleared."}

@app.post("/api/chat")
async def chat_stream(request: ChatRequest):
    """
    Retrieves context from ChromaDB, constructs dynamic prompt based on explanation level and knowledge mode,
    and streams LLM tokens chunk-by-chunk in JSON Lines structure.
    """
    request.knowledge_mode = "strict_rag"
    client = get_async_groq_client()
    
    # Combine single doc_filter and multiple doc_filters for compatibility
    filters = []
    if request.doc_filters:
        filters = request.doc_filters
    elif request.doc_filter:
        filters = [request.doc_filter]
        
    is_scoped = len(filters) > 0
    
    # Detect academic intent and sanitize query for Chroma retrieval
    academic_mode = detect_academic_intent(request.message)
    search_query = request.message
    if academic_mode:
        search_query = clean_query_for_rag(request.message)
        logger.info(f"Academic mode detected: {academic_mode}. Cleaned search query: '{search_query}'")
    
    # 1. Similarity Search RAG retrieval
    citations = []
    context_str = ""
    
    top_k = request.top_k
    if request.response_depth in ["detailed", "expert"]:
        top_k = max(top_k, 8)
    if academic_mode in ["LONG_FORM_EXAM", "SEMESTER_QUESTIONS"]:
        top_k = max(top_k, 10)
        
    # If in strict_rag mode, we must have filters selected. If not, it's empty citations.
    if request.knowledge_mode == "strict_rag" and not is_scoped:
        citations = []
    else:
        try:
            citations = rag_service.search_similarity(
                query=search_query,
                k=top_k,
                doc_filters=filters
            )
            if citations:
                context_str = "\n\n".join([
                    f"Source Document: {c['metadata']['source']} (Page {c['metadata']['page']})\n"
                    f"Relevance Score: {c['score']:.4f}\n"
                    f"Content: {c['content']}"
                    for c in citations
                ])
        except Exception as e:
            logger.error(f"RAG search error: {e}")

    # Strict RAG mode requires citations. If none exist, yield fallback text and exit.
    if request.knowledge_mode == "strict_rag" and not citations:
        async def empty_stream_generator():
            yield json.dumps({"type": "references", "data": []}) + "\n"
            yield json.dumps({"type": "content", "data": "The selected material does not contain enough information to answer this question."}) + "\n"
        return StreamingResponse(empty_stream_generator(), media_type="application/x-ndjson")

    # Short-circuit for other modes if document scope is set and no citations are found
    if request.knowledge_mode != "internet" and is_scoped and not citations:
        async def empty_stream_generator():
            yield json.dumps({"type": "references", "data": []}) + "\n"
            yield json.dumps({"type": "content", "data": "The selected document(s) do not appear to contain this information."}) + "\n"
        return StreamingResponse(empty_stream_generator(), media_type="application/x-ndjson")

    # 2. Craft Explanation Style Instruction
    explain_instruction = ""
    if request.explanation_mode == "beginner":
        explain_instruction = (
            "Explain topics using simple terms, helpful everyday analogies, and clear descriptions. "
            "Avoid heavy technical jargon, and outline basic concepts first before advancing. "
            "Write in a highly encouraging and friendly manner."
        )
    elif request.explanation_mode == "expert":
        explain_instruction = (
            "Provide a highly rigorous, scholarly, and technical analysis. Use precise scientific, "
            "mathematical, or domain-specific terminology. Include mathematical derivations, markdown "
            "formulas, code blocks, or architectural mermaid diagrams where useful. Do not oversimplify."
        )
    else: # intermediate (default)
        explain_instruction = (
            "Provide a detailed, balanced explanation. Use standard terminology and clear, structured bullet points. "
            "Balance depth with accessibility, outlining details cleanly using headers and lists."
        )

    # 3. Assemble Prompt & History
    depth_instruction = get_depth_instruction(request.response_depth)
    base_instruction = (
        f"Explanation Level style: {explain_instruction}\n"
        f"{depth_instruction}\n"
        "Do NOT include inline file citations (such as [Filename.pdf, Page X]) or source labels in your text. The notes/responses should read naturally and cleanly.\n"
        "OCR NOISE & TOKEN CORRECTIVE UNDERSTANDING:\n"
        "- The retrieved context might contain messy handwritten OCR noise or abbreviations (e.g. 'Sup Count', 'Tip Sek', 'gunk').\n"
        "- DO NOT explain garbled or obviously corrupted OCR tokens literally. Never invent fake definitions for OCR errors.\n"
        "- Perform fuzzy term matching and use correct academic vocabulary (e.g., interpret 'Sup Count' as 'Support Count', 'Tip Sek' as 'Itemset').\n"
        "MATHEMATICAL NOTATION FORMULATION:\n"
        "- Format all math using LaTeX delimiters ($...$ for inline, $$...$$ for display block math on separate lines).\n"
    )

    system_prompt, temp, indicator, _ = configure_knowledge_mode(
        knowledge_mode=request.knowledge_mode,
        context_str=context_str,
        base_prompt_instruction=base_instruction,
        citations_list=citations,
        academic_mode=academic_mode
    )

    messages = [{"role": "system", "content": system_prompt}]
    
    # Append chat history (capped at last 10 messages for token usage efficiency)
    for hist in request.history[-10:]:
        messages.append({"role": hist["role"], "content": hist["content"]})
        
    # Append current message
    messages.append({"role": "user", "content": request.message})

    async def stream_generator():
        # First yield the references metadata so frontend shows the source cards immediately
        yield json.dumps({"type": "references", "data": citations}) + "\n"
        
        # Prepend the source mode visual indicator
        yield json.dumps({"type": "content", "data": indicator}) + "\n"

        try:
            completion = await call_async_llm_stream_with_fallback(messages, temperature=temp)
            async for chunk in completion:
                token = chunk.choices[0].delta.content
                if token:
                    yield json.dumps({"type": "content", "data": token}) + "\n"
        except HTTPException as he:
            yield json.dumps({"type": "error", "data": he.detail}) + "\n"
        except Exception as e:
            logger.error(f"Groq completions error: {e}")
            yield json.dumps({"type": "error", "data": "The AI engine is temporarily busy. Please retry."}) + "\n"

    return StreamingResponse(stream_generator(), media_type="application/x-ndjson")

# Core AI Study Tools
@app.post("/api/summary")
def generate_summary(req: ToolRequest):
    req.knowledge_mode = "strict_rag"
    client = get_groq_client()
    
    files = req.filenames if req.filenames else ([req.filename] if req.filename else [])
    try:
        k = 8
        if req.response_depth in ["detailed", "expert"]:
            k = 12
        docs = rag_service.search_similarity(query="summary overview main topics concepts", k=k, doc_filters=files)
    except Exception as e:
        logger.error(f"RAG search error in generate_summary: {e}")
        docs = []

    if req.knowledge_mode == "strict_rag" and (not files or not docs):
        raise HTTPException(status_code=400, detail="The selected material does not contain enough information to generate a summary.")

    # Craft Explanation Style Instruction
    explain_mode = req.explanation_mode or "intermediate"
    if explain_mode == "beginner":
        explain_instruction = (
            "Explain topics using simple terms, helpful everyday analogies, and clear descriptions. "
            "Avoid heavy technical jargon, and outline basic concepts first before advancing. "
            "Make explanations highly accessible, warm, and easy to understand for beginners."
        )
    elif explain_mode == "expert":
        explain_instruction = (
            "Provide a highly rigorous, scholarly, and technical analysis. Use precise scientific, "
            "mathematical, or domain-specific terminology. Focus on complex mechanisms, formal proofs, "
            "advanced definitions, and scholarly depth. Do not oversimplify."
        )
    else: # intermediate
        explain_instruction = (
            "Provide a detailed, balanced explanation. Use standard terminology and clear, structured bullet points. "
            "Balance depth with accessibility, outlining details cleanly using headers and lists."
        )

    context = "\n\n".join([d["content"] for d in docs])
    depth_instruction = get_depth_instruction(req.response_depth)
    base_instruction = (
        f"Below is content from the study documents: {', '.join(files)}.\n"
        f"Explanation Level style requirements:\n{explain_instruction}\n"
        f"{depth_instruction}\n\n"
        "Please generate a comprehensive, beautifully structured executive summary of the main topics, "
        "key takeaways, and academic themes. Use bold headers, bullet lists, and clear paragraphs. "
        "If there are mathematical formulas, physics models, or chemical structures, render them in LaTeX ($...$ or $$...$$)."
    )

    system_prompt, temp, indicator, _ = configure_knowledge_mode(
        knowledge_mode=req.knowledge_mode,
        context_str=context,
        base_prompt_instruction=base_instruction,
        citations_list=docs
    )

    try:
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": "Generate the summary now."}]
        content = call_llm_with_fallback(messages, temperature=temp)
        # Prepend indicator
        content = indicator + content
        return {"summary": content}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/flashcards")
def generate_flashcards(req: ToolRequest):
    req.knowledge_mode = "strict_rag"
    client = get_groq_client()
    
    files = req.filenames if req.filenames else ([req.filename] if req.filename else [])
    try:
        k = 8
        if req.response_depth in ["detailed", "expert"]:
            k = 12
        docs = rag_service.search_similarity(query="definitions key terms vocabulary core facts", k=k, doc_filters=files)
    except Exception as e:
        logger.error(f"RAG search error in generate_flashcards: {e}")
        docs = []
        
    if req.knowledge_mode == "strict_rag" and (not files or not docs):
        raise HTTPException(status_code=400, detail="The selected material does not contain enough information to generate flashcards.")

    explain_mode = req.explanation_mode or "intermediate"
    if explain_mode == "beginner":
        explain_instruction = (
            "Explain topics using simple terms, helpful everyday analogies, and clear descriptions. "
            "Avoid heavy technical jargon, and outline basic concepts first before advancing."
        )
    elif explain_mode == "expert":
        explain_instruction = (
            "Provide a highly rigorous, scholarly, and technical analysis. Use precise scientific, "
            "mathematical, or domain-specific terminology. Focus on complex mechanisms, formal proofs, "
            "advanced definitions, and scholarly depth."
        )
    else: # intermediate
        explain_instruction = (
            "Provide a detailed, balanced explanation. Use standard terminology and clear, structured bullet points. "
            "Balance depth with accessibility, outlining details cleanly using headers and lists."
        )

    context = "\n\n".join([d["content"] for d in docs])
    
    # Configure custom prompts depending on knowledge_mode
    if req.knowledge_mode == "strict_rag":
        prompt_rules = (
            "Generate study flashcards strictly based ONLY on the provided context.\n"
            "Do NOT include any external information, world knowledge, or concepts not mentioned in the context.\n"
            "If the context is empty or insufficient, return an empty array []."
        )
        temp = 0.05
        indicator = ""
    elif req.knowledge_mode == "internet":
        prompt_rules = (
            "Generate study flashcards about the topics in the documents using your general educational and internet knowledge.\n"
            "You are encouraged to bring in external definitions, explanations, and modern examples."
        )
        temp = 0.4
        indicator = ""
    else: # hybrid
        prompt_rules = (
            "Generate study flashcards combining details from the provided context and general educational knowledge.\n"
            "Mix questions based directly on the context and those from general related concepts."
        )
        temp = 0.3
        indicator = ""

    num_cards = req.count or 8
    if not req.count:
        if req.response_depth == "concise":
            num_cards = 5
        elif req.response_depth in ["detailed", "expert"]:
            num_cards = 12
        
    depth_instruction = get_depth_instruction(req.response_depth)
    prompt = (
        f"Below is content from the study documents: {', '.join(files)}.\n"
        f"Explanation Level style requirements:\n{explain_instruction}\n"
        f"{depth_instruction}\n\n"
        f"Rules:\n{prompt_rules}\n\n"
        f"Generate a JSON array of {num_cards} study flashcards. Each flashcard MUST have a 'question' (front) "
        "and an 'answer' (back). Adjust the complexity, depth, and vocabulary of both questions and answers to match the specified explanation level. "
        "If questions or answers include mathematical formulas, write them in standard, valid LaTeX "
        "delimited by single dollars ($...$) for inline and double dollars ($$...$$) for display block math.\n"
        "Return ONLY the raw JSON array, with no markdown tags or introductory text.\n\n"
        f"Example Format:\n[\n  {{\"question\": \"Question text?\", \"answer\": \"Answer text\"}}\n]\n\n"
        f"--- CONTEXT ---\n{context}"
    )

    try:
        raw_text = call_llm_with_fallback(prompt, temperature=temp)
        if raw_text.startswith("```json"):
            raw_text = raw_text.replace("```json", "").replace("```", "").strip()
        elif raw_text.startswith("```"):
            raw_text = raw_text.strip("`").strip()
            
        flashcards = json.loads(raw_text)
        return {
            "flashcards": flashcards, 
            "source_indicator": indicator, 
            "knowledge_mode": req.knowledge_mode or "hybrid"
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Flashcards generation error: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate valid flashcards array.")

@app.post("/api/quiz")
def generate_quiz(req: ToolRequest):
    req.knowledge_mode = "strict_rag"
    client = get_groq_client()
    
    files = req.filenames if req.filenames else ([req.filename] if req.filename else [])
    try:
        k = 8
        if req.response_depth in ["detailed", "expert"]:
            k = 12
        docs = rag_service.search_similarity(query="facts theories calculations details questions", k=k, doc_filters=files)
    except Exception as e:
        logger.error(f"RAG search error in generate_quiz: {e}")
        docs = []
        
    if req.knowledge_mode == "strict_rag" and (not files or not docs):
        raise HTTPException(status_code=400, detail="The selected material does not contain enough information to generate a quiz.")

    explain_mode = req.explanation_mode or "intermediate"
    if explain_mode == "beginner":
        explain_instruction = (
            "Explain topics using simple terms, helpful everyday analogies, and clear descriptions. "
            "Avoid heavy technical jargon, and outline basic concepts first before advancing."
        )
    elif explain_mode == "expert":
        explain_instruction = (
            "Provide a highly rigorous, scholarly, and technical analysis. Use precise scientific, "
            "mathematical, or domain-specific terminology. Focus on complex mechanisms, formal proofs, "
            "advanced definitions, and scholarly depth."
        )
    else: # intermediate
        explain_instruction = (
            "Provide a detailed, balanced explanation. Use standard terminology and clear, structured bullet points. "
            "Balance depth with accessibility, outlining details cleanly using headers and lists."
        )

    context = "\n\n".join([d["content"] for d in docs])
    
    # Configure custom prompts depending on knowledge_mode
    if req.knowledge_mode == "strict_rag":
        prompt_rules = (
            "Generate multiple choice quiz questions strictly based ONLY on the provided context.\n"
            "Do NOT include questions testing external information or world knowledge not present in the context.\n"
            "If context is insufficient, return empty array []."
        )
        temp = 0.05
        indicator = ""
    elif req.knowledge_mode == "internet":
        prompt_rules = (
            "Generate multiple choice quiz questions about the topics in the documents using your general educational and internet knowledge.\n"
            "You are encouraged to test broader concepts and applications."
        )
        temp = 0.4
        indicator = ""
    else: # hybrid
        prompt_rules = (
            "Generate multiple choice quiz questions combining details from the provided context and general educational knowledge.\n"
            "Mix questions testing specific facts in the context and general applications."
        )
        temp = 0.3
        indicator = ""

    num_questions = req.count or 5
    if not req.count:
        if req.response_depth == "concise":
            num_questions = 3
        elif req.response_depth in ["detailed", "expert"]:
            num_questions = 8
        
    depth_instruction = get_depth_instruction(req.response_depth)
    prompt = (
        f"Below is content from the study documents: {', '.join(files)}.\n"
        f"Explanation Level style requirements:\n{explain_instruction}\n"
        f"{depth_instruction}\n\n"
        f"Rules:\n{prompt_rules}\n\n"
        "CRITICAL QUESTION QUALITY & CONTEXT RULES:\n"
        "1. Every question MUST be fully self-contained, educational, and readable independently. Do NOT generate contextless, vague, or isolated questions.\n"
        "2. Avoid using vague references like 'the code', 'this variable', 'the above diagram', or 'the function' unless the code snippet or context is explicitly written inside the question itself.\n"
        "3. Reject any questions that reference invisible or missing assets, code blocks, or diagrams.\n"
        "4. If a question is code-related, you MUST include the complete code snippet directly inside the 'question' string (e.g., using markdown code blocks with three backticks ```python ... ```) so the student has all necessary context in the card.\n"
        "5. Focus on conceptual, educational, and complete questions. For example:\n"
        "   - Good: 'What is the purpose of NumPy arrays in data science?'\n"
        "   - Good: 'Given the Python function `def add(x, y): return x + y`, what does `add(3, 4)` output?'\n"
        "   - Bad: 'What does variable a represent in the function?' (without showing the function)\n"
        "   - Bad: 'What is the relationship between a and b in this code?' (without showing the code)\n\n"
        f"Generate a JSON array of {num_questions} multiple-choice questions (MCQs) for a quiz. "
        "Adjust the question difficulty, rigor of options, and depth of explanations to match the specified explanation level. "
        "Each question MUST contain:\n"
        "1. 'question': The question query string.\n"
        "2. 'options': An array of 4 option strings.\n"
        "3. 'correct_answer': The string matching the exact correct option.\n"
        "4. 'explanation': A detailed explanation of why the correct option is right.\n"
        "If questions, options, or explanations include mathematical formulas or scientific equations, "
        "write them in standard, valid LaTeX delimited by single dollars ($...$) for inline and double dollars ($$...$$) for display block math.\n"
        "Return ONLY the raw JSON array, with no explanation or backticks.\n\n"
        f"Example Format:\n[\n  {{\"question\": \"Q\", \"options\": [\"A\",\"B\",\"C\",\"D\"], \"correct_answer\": \"A\", \"explanation\": \"E\"}}\n]\n\n"
        f"--- CONTEXT ---\n{context}"
    )

    try:
        raw_text = call_llm_with_fallback(prompt, temperature=temp)
        if raw_text.startswith("```json"):
            raw_text = raw_text.replace("```json", "").replace("```", "").strip()
        elif raw_text.startswith("```"):
            raw_text = raw_text.strip("`").strip()

        quiz = json.loads(raw_text)
        return {
            "quiz": quiz, 
            "source_indicator": indicator, 
            "knowledge_mode": req.knowledge_mode or "hybrid"
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Quiz generation error: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate valid quiz questions.")

@app.post("/api/questions")
def generate_important_questions(req: ToolRequest):
    req.knowledge_mode = "strict_rag"
    client = get_groq_client()
    
    files = req.filenames if req.filenames else ([req.filename] if req.filename else [])
    try:
        k = 8
        if req.response_depth in ["detailed", "expert"]:
            k = 12
        docs = rag_service.search_similarity(query="critical questions testing examination review points", k=k, doc_filters=files)
    except Exception as e:
        logger.error(f"RAG search error in generate_important_questions: {e}")
        docs = []

    if req.knowledge_mode == "strict_rag" and (not files or not docs):
        raise HTTPException(status_code=400, detail="The selected material does not contain enough information to extract questions.")

    explain_mode = req.explanation_mode or "intermediate"
    if explain_mode == "beginner":
        explain_instruction = (
            "Explain topics using simple terms, helpful everyday analogies, and clear descriptions. "
            "Avoid heavy technical jargon, and outline basic concepts first before advancing."
        )
    elif explain_mode == "expert":
        explain_instruction = (
            "Provide a highly rigorous, scholarly, and technical analysis. Use precise scientific, "
            "mathematical, or domain-specific terminology. Focus on complex mechanisms, formal proofs, "
            "advanced definitions, and scholarly depth."
        )
    else: # intermediate
        explain_instruction = (
            "Provide a detailed, balanced explanation. Use standard terminology and clear, structured bullet points. "
            "Balance depth with accessibility, outlining details cleanly using headers and lists."
        )

    context = "\n\n".join([d["content"] for d in docs])
    num_questions = 7
    if req.response_depth == "concise":
        num_questions = 4
    elif req.response_depth in ["detailed", "expert"]:
        num_questions = 12
        
    depth_instruction = get_depth_instruction(req.response_depth)
    base_instruction = (
        f"Identify the top {num_questions} most critical examination/review questions that could be asked from the documents: {', '.join(files)}.\n"
        f"Explanation Level style requirements:\n{explain_instruction}\n"
        f"{depth_instruction}\n\n"
        "Provide detailed answers for each question, referencing the facts in the text. Format the output in clean, elegant Markdown.\n"
        "Adjust the rigor, terminology, and style of both questions and answers to match the specified explanation level.\n"
        "Render any mathematical formula, equation, or scientific notation using standard LaTeX: wrap inline math in $...$ and display math in $$...$$ on separate lines."
    )

    system_prompt, temp, indicator, _ = configure_knowledge_mode(
        knowledge_mode=req.knowledge_mode,
        context_str=context,
        base_prompt_instruction=base_instruction,
        citations_list=docs
    )

    try:
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": "Generate important questions now."}]
        content = call_llm_with_fallback(messages, temperature=temp)
        content = indicator + content
        return {"questions": content}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/formulas")
def extract_formulas(req: ToolRequest):
    req.knowledge_mode = "strict_rag"
    client = get_groq_client()
    
    files = req.filenames if req.filenames else ([req.filename] if req.filename else [])
    try:
        k = 8
        if req.response_depth in ["detailed", "expert"]:
            k = 12
        docs = rag_service.search_similarity(query="equations mathematics formulas physics constants functions algorithms", k=k, doc_filters=files)
    except Exception as e:
        logger.error(f"RAG search error in extract_formulas: {e}")
        docs = []

    if req.knowledge_mode == "strict_rag" and (not files or not docs):
        raise HTTPException(status_code=400, detail="The selected material does not contain enough information to extract formulas.")

    explain_mode = req.explanation_mode or "intermediate"
    if explain_mode == "beginner":
        explain_instruction = (
            "Explain topics using simple terms, helpful everyday analogies, and clear descriptions. "
            "Avoid heavy technical jargon, and outline basic concepts first before advancing."
        )
    elif explain_mode == "expert":
        explain_instruction = (
            "Provide a highly rigorous, scholarly, and technical analysis. Use precise scientific, "
            "mathematical, or domain-specific terminology. Focus on complex mechanisms, formal proofs, "
            "advanced definitions, and scholarly depth."
        )
    else: # intermediate
        explain_instruction = (
            "Provide a detailed, balanced explanation. Use standard terminology and clear, structured bullet points. "
            "Balance depth with accessibility, outlining details cleanly using headers and lists."
        )

    context = "\n\n".join([d["content"] for d in docs])
    depth_instruction = get_depth_instruction(req.response_depth)
    base_instruction = (
        f"You are a premium scientific concept analyzer and mathematical study assistant.\n"
        f"Scan the study documents: {', '.join(files)} and perform a comprehensive extraction of formulas, "
        "equations, computational operations, algorithms, and key scientific/technical concepts.\n\n"
        "CRITICAL RULES & EXPECTATIONS:\n"
        "1. DO NOT RETURN 'NO FORMULAS FOUND' OR COLD DISCLAIMERS: If the document contains no explicit mathematical equations, "
        "you MUST gracefully pivot into extracting computational logic, technical operations, syntax patterns, algorithmic rules, "
        "and scientific principles. The output must ALWAYS be a deep, detailed educational resource.\n"
        "2. DETAILED ACADEMIC CONTENT STRUCTURE: Generate comprehensive study-guide-grade content. Structure the response using "
        "clear markdown headers with the following sections (only skip a section if it is completely irrelevant, but aim to cover "
        "these extensively):\n"
        "   - **Key Scientific/Mathematical Concepts** (Detailed conceptual breakdowns, core theories)\n"
        "   - **Formulas & Mathematical Logic** (Explicit mathematical, chemical, physics formulas in LaTeX, or the primary mathematical logic governing the topic)\n"
        "   - **Important Technical Operations & Algorithms** (Step-by-step procedures, computational steps, logical flows)\n"
        "   - **Core Definitions & Terminology** (Glossary-grade entries of scientific vocabulary)\n"
        "   - **Practical Examples & Code Interpretation** (If code snippets or examples exist, interpret them completely. Explain the function call, parameters, expected output, and why it is used—e.g. `np.zeros((2,3))` creates a 2x3 matrix of floats initialized to 0, commonly used for placeholder initialization or buffer allocation)\n"
        "   - **Common Use Cases & Real-world Applications** (Where these techniques or formulas are applied in production/industry)\n"
        "   - **Concept Relationships & Computational Logic** (How these concepts connect, trade-offs in efficiency, time/space complexity)\n"
        "3. EXPLAIN TECHNICAL CONCEPTS DEEPLY: For programming/scientific documents (like NumPy or Pandas), do not give shallow descriptions. "
        "Actually explain concepts like multidimensional array slicing, vectorization, shape broadcasting, memory layouts (C-contiguous vs Fortran-contiguous), "
        "dimension axis behavior, indexing mechanisms, and computational speed gains.\n"
        "4. MATHEMATICAL FORMATTING: Render every equation, variable reference, function name, and constant in beautiful valid LaTeX: "
        "use single dollar signs ($...$) for inline mathematical entities, and double dollar signs ($$...$$) on separate lines for display block equations.\n"
        "5. EXPANDED RESPONSE LENGTH: Ensure the generated output is rich, technical, educational, and thorough. Avoid generic filler, "
        "extremely short responses, or shallow summaries. It should feel like textbook chapters for exam preparation.\n\n"
        f"Explanation Level style requirements:\n{explain_instruction}\n"
        f"{depth_instruction}"
    )

    system_prompt, temp, indicator, _ = configure_knowledge_mode(
        knowledge_mode=req.knowledge_mode,
        context_str=context,
        base_prompt_instruction=base_instruction,
        citations_list=docs
    )

    try:
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": "Extract formulas now."}]
        content = call_llm_with_fallback(messages, temperature=temp)
        content = indicator + content
        return {"formulas": content}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/definitions")
def extract_definitions(req: ToolRequest):
    req.knowledge_mode = "strict_rag"
    client = get_groq_client()
    
    files = req.filenames if req.filenames else ([req.filename] if req.filename else [])
    try:
        k = 8
        if req.response_depth in ["detailed", "expert"]:
            k = 12
        docs = rag_service.search_similarity(query="glossary vocabulary definitions terms vocabulary", k=k, doc_filters=files)
    except Exception as e:
        logger.error(f"RAG search error in extract_definitions: {e}")
        docs = []

    if req.knowledge_mode == "strict_rag" and (not files or not docs):
        raise HTTPException(status_code=400, detail="The selected material does not contain enough information to extract definitions.")

    explain_mode = req.explanation_mode or "intermediate"
    if explain_mode == "beginner":
        explain_instruction = (
            "Explain topics using simple terms, helpful everyday analogies, and clear descriptions. "
            "Avoid heavy technical jargon, and outline basic concepts first before advancing."
        )
    elif explain_mode == "expert":
        explain_instruction = (
            "Provide a highly rigorous, scholarly, and technical analysis. Use precise scientific, "
            "mathematical, or domain-specific terminology. Focus on complex mechanisms, formal proofs, "
            "advanced definitions, and scholarly depth."
        )
    else: # intermediate
        explain_instruction = (
            "Provide a detailed, balanced explanation. Use standard terminology and clear, structured bullet points. "
            "Balance depth with accessibility, outlining details cleanly using headers and lists."
        )

    context = "\n\n".join([d["content"] for d in docs])
    depth_instruction = get_depth_instruction(req.response_depth)
    base_instruction = (
        f"Extract all important terminology, vocabulary, and definitions from the study documents: {', '.join(files)}.\n"
        f"Explanation Level style requirements:\n{explain_instruction}\n"
        f"{depth_instruction}\n\n"
        "Create a glossary list explaining the term, context, and key details. Format the output in Markdown table structure.\n"
        "Adjust the complexity and explanations in the glossary to match the specified explanation level.\n"
        "If definitions or terms include equations/symbols, format them in standard, valid LaTeX ($...$ or $$...$$)."
    )

    system_prompt, temp, indicator, _ = configure_knowledge_mode(
        knowledge_mode=req.knowledge_mode,
        context_str=context,
        base_prompt_instruction=base_instruction,
        citations_list=docs
    )

    try:
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": "Extract definitions now."}]
        content = call_llm_with_fallback(messages, temperature=temp)
        content = indicator + content
        return {"definitions": content}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/notes")
async def generate_notes(req: ToolRequest):
    req.knowledge_mode = "strict_rag"
    client = get_async_groq_client()
    
    files = req.filenames if req.filenames else ([req.filename] if req.filename else [])
    
    # Dynamically adjust retrieval depth based on notes generation mode and response depth
    k = 8
    if req.notes_mode == "deep" or req.response_depth in ["detailed", "expert"]:
        k = 15
    elif req.notes_mode == "detailed":
        k = 10
        
    try:
        docs = rag_service.search_similarity(query="important concepts outline guide summary definitions glossary key points", k=k, doc_filters=files)
    except Exception as e:
        logger.error(f"RAG search error in generate_notes: {e}")
        docs = []

    # If in strict_rag mode, we must have files and docs. If not, it's empty docs.
    if req.knowledge_mode == "strict_rag" and (not files or not docs):
        async def empty_stream_generator():
            yield json.dumps({"type": "content", "data": "The selected material does not contain enough information to generate notes."}) + "\n"
        return StreamingResponse(empty_stream_generator(), media_type="application/x-ndjson")

    explain_mode = req.explanation_mode or "intermediate"
    if explain_mode == "beginner":
        explain_instruction = (
            "Explain topics using simple terms, helpful everyday analogies, and clear descriptions. "
            "Avoid heavy technical jargon, and outline basic concepts first before advancing."
        )
    elif explain_mode == "expert":
        explain_instruction = (
            "Provide a highly rigorous, scholarly, and technical analysis. Use precise scientific, "
            "mathematical, or domain-specific terminology. Focus on complex mechanisms, formal proofs, "
            "advanced definitions, and scholarly depth."
        )
    else: # intermediate
        explain_instruction = (
            "Provide a detailed, balanced explanation. Use standard terminology and clear, structured bullet points. "
            "Balance depth with accessibility, outlining details cleanly using headers and lists."
        )

    context = "\n\n".join([d["content"] for d in docs])
    
    depth_instruction = get_depth_instruction(req.response_depth)
    # Prompt strategies for each notes generation mode, styled by explanation_mode
    if req.notes_mode == "quick":
        base_instruction = (
            "Please generate a concise, exam-focused set of study notes in Quick Revision Mode.\n"
            f"Explanation Level style requirements:\n{explain_instruction}\n"
            f"{depth_instruction}\n\n"
            "Requirements:\n"
            "- Focus on high-yield exam concepts and short summaries.\n"
            "- Organize content into brief bullet-point notes with clear headings.\n"
            "- Keep it highly structured and readable (ideal for quick revision in 1-3 pages).\n"
            "- Render all mathematical notation and equations in clean LaTeX (wrap inline symbols/variables in $...$ and block/display formulas in $$...$$ on their own lines).\n"
            "- Use bolding for key terms where appropriate."
        )
    elif req.notes_mode == "deep":
        base_instruction = (
            "Please generate an exhaustive, long-form academic study notebook in Mastery / Deep Research Mode.\n"
            f"Explanation Level style requirements:\n{explain_instruction}\n"
            f"{depth_instruction}\n\n"
            "Requirements:\n"
            "- Provide highly detailed, advanced long-form explanations with a chapter-wise breakdown.\n"
            "- Include detailed examples and real-world case studies.\n"
            "- Create a comprehensive Glossary table defining key technical terminology.\n"
            "- Suggest memory tricks, mnemonics, or analogies to understand difficult topics.\n"
            "- Explain concept relationships and how different topics connect.\n"
            "- Provide realistic practice interview/exam questions with detailed solutions.\n"
            "- Render all mathematical notation, formulas, variables, derivatives, integrals, and scientific/chemical notation in valid, beautiful LaTeX (inline wrapped in $...$, block/display wrapped in $$...$$ on separate lines).\n"
            "- Write exhaustive, comprehensive notes (targeted length equivalent to 15-40+ pages)."
        )
    else:  # detailed (default)
        base_instruction = (
            "Please generate a detailed, structured study guide in Detailed Learning Mode.\n"
            f"Explanation Level style requirements:\n{explain_instruction}\n"
            f"{depth_instruction}\n\n"
            "Requirements:\n"
            "- Provide comprehensive explanations of each core concept.\n"
            "- Include clear illustrative examples and step-by-step breakdowns.\n"
            "- Organize into structured logical sections (Summary, Detailed Concepts, Applications).\n"
            "- Render all mathematical equations, formulas, variables, and notation in clean LaTeX format (inline wrapped in $...$ and block/display formulas wrapped in $$...$$ on their own lines).\n"
            "- Use tables, lists, and quotes to enhance readability (targeted length equivalent to 5-15 pages)."
        )

    system_prompt, temp, indicator, _ = configure_knowledge_mode(
        knowledge_mode=req.knowledge_mode,
        context_str=context,
        base_prompt_instruction=base_instruction,
        citations_list=docs
    )

    async def stream_generator():
        yield json.dumps({"type": "content", "data": indicator}) + "\n"
        try:
            messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": "Generate the study notes now."}]
            completion = await call_async_llm_stream_with_fallback(messages, temperature=temp)
            async for chunk in completion:
                token = chunk.choices[0].delta.content
                if token:
                    yield json.dumps({"type": "content", "data": token}) + "\n"
        except HTTPException as he:
            yield json.dumps({"type": "error", "data": he.detail}) + "\n"
        except Exception as e:
            logger.error(f"Groq notes completions error: {e}")
            yield json.dumps({"type": "error", "data": "The AI engine is temporarily busy. Please retry."}) + "\n"

    return StreamingResponse(stream_generator(), media_type="application/x-ndjson")

@app.post("/api/planner")
def generate_study_planner(req: PlannerRequest):
    """
    Creates a customized AI study schedule mapping daily study tasks and chapters based on uploaded files.
    """
    client = get_groq_client()
    
    context_clips = []
    for fn in req.filenames[:3]: # Limit to first 3 files to fit prompts safely
        docs = rag_service.search_similarity(query="table of contents outline index chapters", k=4, doc_filters=[fn])
        if docs:
            context_clips.append(f"Document: {fn}\nContents outline:\n" + "\n".join([d["content"] for d in docs]))

    context = "\n\n---\n\n".join(context_clips)
    prompt = (
        f"You are an expert AI Study Planner. Create a comprehensive, customized study schedule for the user.\n"
        f"Study files: {', '.join(req.filenames)}\n"
        f"Timeframe: {req.timeframe_weeks} Weeks\n"
        f"Commitment: {req.daily_hours} Hours per day\n\n"
        "Generate a structured, professional weekly study plan. For each week, break down the learning goals, "
        "chapters/concepts to study (linked to the documents), daily task lists, and weekly review quizzes. "
        "Keep all descriptions in clean, readable plain text. Do NOT include complex LaTeX equations, "
        "mathematical formatting delimiters like $, $$, \\[, or \\], or raw formatting blocks. "
        "Do NOT include any technical metadata or parser output (such as 'LaTeX representation', 'OCR confidence', or 'reconstruction_confidence'). "
        "Use simple clean text tables and markdown list formatting for the tasks. "
        "Make it highly practical, motivational, and easy to follow.\n\n"
        f"--- DOCUMENTS OVERVIEW CONTEXT ---\n{context or 'No structural outlines retrieved. Generate a standard plan.'}"
    )

    try:
        content = call_llm_with_fallback(prompt, temperature=0.4)
        return {"planner": content}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def get_ist_time_str() -> str:
    # IST is UTC + 5:30
    tz = timezone(timedelta(hours=5, minutes=30))
    dt = datetime.now(tz)
    day = dt.strftime("%d").lstrip("0")
    month_year = dt.strftime("%b %Y")
    hour = dt.strftime("%I").lstrip("0")
    minute_ampm = dt.strftime("%M %p IST")
    return f"{day} {month_year}, {hour}:{minute_ampm}"

def get_filename_safe_ist_time_str() -> str:
    ist_str = get_ist_time_str()
    return ist_str.replace(", ", "_").replace(" ", "_").replace(":", "_")

def inline_markdown_to_html(text: str) -> str:
    # 1. Escape XML characters
    text = html.escape(text)
    
    # 2. Block formulas: $$formula$$
    text = re.sub(r'\$\$(.*?)\$\$', r'<font color="#b38728"><b>\1</b></font>', text, flags=re.DOTALL)
    
    # 3. Inline formulas: $formula$
    text = re.sub(r'\$(.*?)\$', r'<i><font color="#0f172a">\1</font></i>', text)
    
    # 4. Convert bold: **text** or __text__
    text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'__(.*?)__', r'<b>\1</b>', text)
    
    # 5. Convert italic: *text* or _text_
    text = re.sub(r'\*(.*?)\*', r'<i>\1</i>', text)
    text = re.sub(r'_(.*?)_', r'<i>\1</i>', text)
    
    # 6. Convert inline code: `code`
    text = re.sub(r'`(.*?)`', r'<font name="Courier" color="#b38728"><b>\1</b></font>', text)
    
    # 7. Convert highlight: ==text==
    text = re.sub(r'==(.*?)==', r'<font color="#b38728"><b>\1</b></font>', text)
    
    return text

def create_heading(text: str, level: int):
    html_text = inline_markdown_to_html(text)
    if level == 1:
        style = ParagraphStyle(
            'H1Style',
            fontName='Helvetica-Bold',
            fontSize=18,
            textColor=colors.HexColor('#0F172A'),
            spaceBefore=16,
            spaceAfter=8,
            keepWithNext=True
        )
    elif level == 2:
        style = ParagraphStyle(
            'H2Style',
            fontName='Helvetica-Bold',
            fontSize=14,
            textColor=colors.HexColor('#B38728'),
            spaceBefore=14,
            spaceAfter=6,
            keepWithNext=True
        )
    elif level == 3:
        style = ParagraphStyle(
            'H3Style',
            fontName='Helvetica-Bold',
            fontSize=12,
            textColor=colors.HexColor('#1E293B'),
            spaceBefore=12,
            spaceAfter=4,
            keepWithNext=True
        )
    else:
        style = ParagraphStyle(
            'H4Style',
            fontName='Helvetica-BoldOblique',
            fontSize=10.5,
            textColor=colors.HexColor('#334155'),
            spaceBefore=10,
            spaceAfter=4,
            keepWithNext=True
        )
    
    try:
        return Paragraph(html_text, style)
    except Exception as e:
        logger.warning(f"Failed to compile heading Paragraph: {e}. Falling back to plain text heading.")
        return Paragraph(html.escape(text), style)

def create_paragraph(text: str):
    html_text = inline_markdown_to_html(text)
    style = ParagraphStyle(
        'ParaStyle',
        fontName='Helvetica',
        fontSize=10,
        textColor=colors.HexColor('#334155'),
        leading=14,
        spaceAfter=8
    )
    try:
        return Paragraph(html_text, style)
    except Exception as e:
        logger.warning(f"Failed to compile paragraph: {e}. Falling back to plain text.")
        return Paragraph(html.escape(text), style)

def create_code_block(code_lines: List[str], width: float = 504.0):
    import uuid
    if not code_lines:
        code_lines = [""]
    table_cell_data = []
    unique_id = uuid.uuid4().hex[:8]
    for idx, line in enumerate(code_lines):
        escaped_line = html.escape(line)
        if not escaped_line.strip():
            escaped_line = "&nbsp;"
        line_style = ParagraphStyle(
            f'CodeLine_{unique_id}_{idx}',
            fontName='Courier',
            fontSize=8.5,
            textColor=colors.HexColor('#0F172A'),
            leading=11,
            spaceAfter=0,
            spaceBefore=0,
        )
        try:
            p = Paragraph(escaped_line, line_style)
        except Exception:
            p = Paragraph(html.escape(line), line_style)
        table_cell_data.append([p])
        
    t = Table(table_cell_data, colWidths=[width], splitByRow=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F1F5F9')),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 1.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 1.5),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 8),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
    ]))
    return t

def create_blockquote(blockquote_lines: List[str], width: float = 504.0):
    import uuid
    if not blockquote_lines:
        blockquote_lines = [""]
    table_cell_data = []
    unique_id = uuid.uuid4().hex[:8]
    for idx, line in enumerate(blockquote_lines):
        html_text = inline_markdown_to_html(line)
        if not html_text.strip():
            html_text = "&nbsp;"
        quote_line_style = ParagraphStyle(
            f'QuoteLine_{unique_id}_{idx}',
            fontName='Helvetica-Oblique',
            fontSize=10,
            textColor=colors.HexColor('#475569'),
            leading=14,
            spaceAfter=0,
            spaceBefore=0,
        )
        try:
            p = Paragraph(html_text, quote_line_style)
        except Exception:
            p = Paragraph(html.escape(line), quote_line_style)
        table_cell_data.append([p])
        
    t = Table(table_cell_data, colWidths=[width], splitByRow=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#FDFBF7')),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 10),
        ('LINELEFT', (0, 0), (0, -1), 3, colors.HexColor('#B38728')),
    ]))
    return t

def create_list(list_items: List[tuple], list_type: str):
    list_flowables = []
    for idx, (item, indent_len) in enumerate(list_items):
        html_text = inline_markdown_to_html(item)
        indent = 15 + (indent_len // 2) * 10
        
        list_item_style = ParagraphStyle(
            f'ListItemStyle_{idx}_{indent}',
            fontName='Helvetica',
            fontSize=10,
            textColor=colors.HexColor('#334155'),
            leading=14,
            leftIndent=indent,
            firstLineIndent=-10,
            spaceAfter=4
        )
        
        if list_type == 'unordered':
            if indent_len > 0:
                bullet = '<font color="#B38728">&#9642;</font> '
            else:
                bullet = '<font color="#B38728">&#8226;</font> '
        else:
            bullet = f'<font color="#B38728">{idx + 1}.</font> '
            
        try:
            list_flowables.append(Paragraph(bullet + html_text, list_item_style))
        except Exception:
            list_flowables.append(Paragraph(bullet + html.escape(item), list_item_style))
    return list_flowables

def create_table(table_lines: List[str], width: float = 504.0):
    rows_data = []
    col_count = 0
    for idx, line in enumerate(table_lines):
        parts = [p.strip() for p in line.strip().split('|')]
        if line.strip().startswith('|'):
            parts = parts[1:]
        if line.strip().endswith('|'):
            parts = parts[:-1]
            
        if idx == 1 and all(re.match(r'^[\s\-:]+$', p) for p in parts):
            continue
            
        rows_data.append(parts)
        col_count = max(col_count, len(parts))
        
    if not rows_data:
        return Spacer(1, 1)
        
    for r in rows_data:
        while len(r) < col_count:
            r.append('')
            
    table_cell_data = []
    cell_header_style = ParagraphStyle(
        'CellHeader',
        fontName='Helvetica-Bold',
        fontSize=9,
        textColor=colors.HexColor('#ffffff'),
        leading=12
    )
    cell_body_style = ParagraphStyle(
        'CellBody',
        fontName='Helvetica',
        fontSize=8.5,
        textColor=colors.HexColor('#334155'),
        leading=11
    )
    
    for r_idx, row in enumerate(rows_data):
        cell_row = []
        for col in row:
            style = cell_header_style if r_idx == 0 else cell_body_style
            html_text = inline_markdown_to_html(col)
            try:
                cell_row.append(Paragraph(html_text, style))
            except Exception:
                cell_row.append(Paragraph(html.escape(col), style))
        table_cell_data.append(cell_row)
        
    col_widths = [width / col_count] * col_count
    t = Table(table_cell_data, colWidths=col_widths, repeatRows=1)
    
    t_style = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0F172A')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0')),
    ]
    for i in range(1, len(rows_data)):
        if i % 2 == 0:
            t_style.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#F8FAFC')))
        else:
            t_style.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#FFFFFF')))
            
    t.setStyle(TableStyle(t_style))
    return t

def parse_markdown_to_flowables(markdown_content: str, width: float = 504.0):
    flowables = []
    lines = markdown_content.split('\n')
    
    in_code_block = False
    code_lines = []
    in_blockquote = False
    blockquote_lines = []
    in_table = False
    table_lines = []
    in_list = False
    list_type = None
    list_items = []
    
    def flush_states():
        nonlocal in_code_block, code_lines, in_blockquote, blockquote_lines, in_table, table_lines, in_list, list_items, list_type
        if in_code_block and code_lines:
            flowables.append(create_code_block(code_lines, width))
            flowables.append(Spacer(1, 8))
            code_lines = []
            in_code_block = False
            
        if in_blockquote and blockquote_lines:
            flowables.append(create_blockquote(blockquote_lines, width))
            flowables.append(Spacer(1, 8))
            blockquote_lines = []
            in_blockquote = False
            
        if in_table and table_lines:
            flowables.append(create_table(table_lines, width))
            flowables.append(Spacer(1, 8))
            table_lines = []
            in_table = False
            
        if in_list and list_items:
            flowables.extend(create_list(list_items, list_type))
            flowables.append(Spacer(1, 8))
            list_items = []
            in_list = False
            list_type = None

    for line in lines:
        line_str = line.strip()
        
        if line_str.startswith('```'):
            if in_code_block:
                flush_states()
            else:
                flush_states()
                in_code_block = True
            continue
            
        if in_code_block:
            code_lines.append(line)
            continue
            
        if line_str.startswith('>') or (in_blockquote and line_str == '' and len(blockquote_lines) > 0):
            if line_str.startswith('>'):
                if not in_blockquote:
                    flush_states()
                    in_blockquote = True
                blockquote_lines.append(line_str[1:].strip())
                continue
            
        if line_str.startswith('|') and line_str.endswith('|'):
            if not in_table:
                flush_states()
                in_table = True
            table_lines.append(line_str)
            continue
            
        unordered_match = re.match(r'^([\s]*)[-*+]\s+(.*)', line)
        ordered_match = re.match(r'^([\s]*)\d+\.\s+(.*)', line)
        if unordered_match or ordered_match:
            current_type = 'unordered' if unordered_match else 'ordered'
            indent_spaces = len(unordered_match.group(1)) if unordered_match else len(ordered_match.group(1))
            content = unordered_match.group(2) if unordered_match else ordered_match.group(2)
            
            if in_list and list_type != current_type:
                flush_states()
                
            if not in_list:
                flush_states()
                in_list = True
                in_list_type = current_type
                list_type = current_type
                
            list_items.append((content, indent_spaces))
            continue
            
        if line_str.startswith('# '):
            flush_states()
            flowables.append(create_heading(line_str[2:], 1))
            continue
        elif line_str.startswith('## '):
            flush_states()
            flowables.append(create_heading(line_str[3:], 2))
            continue
        elif line_str.startswith('### '):
            flush_states()
            flowables.append(create_heading(line_str[4:], 3))
            continue
        elif line_str.startswith('#### '):
            flush_states()
            flowables.append(create_heading(line_str[5:], 4))
            continue
            
        if line_str in ['---', '***', '___']:
            flush_states()
            flowables.append(PageBreak())
            continue
            
        if not line_str:
            flush_states()
            flowables.append(Spacer(1, 6))
            continue
            
        flush_states()
        flowables.append(create_paragraph(line_str))
        
    flush_states()
    return flowables

def add_header_footer(canvas, doc):
    canvas.saveState()
    # Header
    canvas.setFont('Helvetica-Bold', 8)
    canvas.setFillColor(colors.HexColor('#B38728'))
    canvas.drawString(54, 755, "Yeseswini's AI Study Assistant")
    
    canvas.setStrokeColor(colors.HexColor('#E2E8F0'))
    canvas.setLineWidth(0.5)
    canvas.line(54, 747, doc.pagesize[0]-54, 747)
    
    # Footer
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#64748B'))
    canvas.drawString(54, 36, f"Generated: {get_ist_time_str()}")
    canvas.drawRightString(doc.pagesize[0]-54, 36, f"Page {doc.page}")
    canvas.restoreState()

@app.post("/api/export-notes")
def export_notes(req: ExportNotesRequest):
    """
    Builds a beautifully styled PDF from markdown notes using ReportLab and sends it as a download.
    """
    import uuid
    pdf_filename = f"study_assistant_notes_{uuid.uuid4().hex[:8]}.pdf"
    pdf_path = os.path.join(settings.UPLOAD_DIR, pdf_filename)

    try:
        # Create PDF layout
        doc = SimpleDocTemplate(
            pdf_path,
            pagesize=letter,
            rightMargin=54, leftMargin=54,
            topMargin=72, bottomMargin=54
        )

        title_style = ParagraphStyle(
            'PDFTitle',
            fontName='Helvetica-Bold',
            fontSize=22,
            textColor=colors.HexColor('#0F172A'),
            spaceAfter=15,
            leading=26
        )

        meta_style = ParagraphStyle(
            'PDFMetadata',
            fontName='Helvetica-Oblique',
            fontSize=10,
            textColor=colors.HexColor('#64748B'),
            spaceAfter=8,
            leading=12
        )

        story = []
        
        # Escape title safely
        escaped_title = html.escape(req.title)
        story.append(Paragraph(escaped_title, title_style))
        
        # Display generation timestamp
        timestamp_str = f"Generated: {get_ist_time_str()}"
        story.append(Paragraph(timestamp_str, meta_style))
        
        # Title separator line
        line_table = Table([['']], colWidths=[504], rowHeights=[2])
        line_table.setStyle(TableStyle([
            ('LINEBELOW', (0, 0), (-1, -1), 1.5, colors.HexColor('#B38728')),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
        ]))
        story.append(line_table)
        story.append(Spacer(1, 15))

        # Parse markdown to flowables
        flowables = parse_markdown_to_flowables(req.markdown_content)
        story.extend(flowables)

        doc.build(story, onFirstPage=add_header_footer, onLaterPages=add_header_footer)
        
        safe_time = get_filename_safe_ist_time_str()
        download_name = f"AI-Study-Assistant-Notes-{safe_time}.pdf"
        
        return FileResponse(
            path=pdf_path,
            filename=download_name,
            media_type="application/pdf"
        )
    except Exception as e:
        logger.error(f"PDF creation error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF document: {str(e)}")

def create_message_header_band(role: str, timestamp: str):
    import uuid
    unique_id = str(uuid.uuid4()).replace('-', '')
    
    # Text styles inside header band
    header_style = ParagraphStyle(
        f'BandHeader_{unique_id}',
        fontName='Helvetica-Bold',
        fontSize=9,
        textColor=colors.HexColor('#475569') if role == 'user' else colors.HexColor('#854D0E'),
        spaceAfter=0,
        spaceBefore=0,
    )
    time_style = ParagraphStyle(
        f'BandTime_{unique_id}',
        fontName='Helvetica',
        fontSize=8,
        textColor=colors.HexColor('#64748B') if role == 'user' else colors.HexColor('#A16207'),
        alignment=2, # Right aligned
        spaceAfter=0,
        spaceBefore=0,
    )
    
    header_para = Paragraph(f"<b>{'STUDENT' if role == 'user' else 'AI ASSISTANT'}</b>", header_style)
    time_para = Paragraph(html.escape(timestamp) if timestamp else "", time_style)
    
    # Create header table spanning the full width of the story (504pt)
    header_table = Table([[header_para, time_para]], colWidths=[252, 252])
    
    if role == 'user':
        bg_color = colors.HexColor('#F1F5F9') # soft slate-100
        border_color = colors.HexColor('#CBD5E1') # slate-300
    else:
        bg_color = colors.HexColor('#FEF9C3') # soft yellow-100 (gold tint)
        border_color = colors.HexColor('#FDE047') # yellow-300
        
    header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg_color),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('BOX', (0, 0), (-1, -1), 0.75, border_color),
    ]))
    
    # Set keepWithNext=True so the header doesn't end up alone at the bottom of the page
    header_table.keepWithNext = True
    return header_table

def create_citations_block(citations: Optional[List[str]], width: float = 504.0):
    if not citations:
        return []
    unique_citations = []
    for c in citations:
        if c not in unique_citations:
            unique_citations.append(c)
    if not unique_citations:
        return []
        
    flowables = []
    flowables.append(Spacer(1, 6))
    
    import uuid
    unique_id = uuid.uuid4().hex[:8]
    citation_title_style = ParagraphStyle(
        f'CitTitle_{unique_id}',
        fontName='Helvetica-Bold',
        fontSize=8.5,
        textColor=colors.HexColor('#B38728'),
        spaceAfter=4,
        keepWithNext=True
    )
    flowables.append(Paragraph("Sources & Citations:", citation_title_style))
    
    for idx, cit in enumerate(unique_citations):
        cit_style = ParagraphStyle(
            f'CitItem_{unique_id}_{idx}',
            fontName='Helvetica-Oblique',
            fontSize=8,
            textColor=colors.HexColor('#64748B'),
            leftIndent=10,
            spaceAfter=3
        )
        flowables.append(Paragraph(f"• {html.escape(cit)}", cit_style))
        
    return flowables

@app.post("/api/export-chat")
def export_chat(req: ExportChatRequest):
    """
    Builds a beautifully styled PDF from chat messages history using ReportLab and sends it as a download.
    """
    import uuid
    pdf_filename = f"study_session_chat_{uuid.uuid4().hex[:8]}.pdf"
    pdf_path = os.path.join(settings.UPLOAD_DIR, pdf_filename)

    try:
        # Create PDF layout
        doc = SimpleDocTemplate(
            pdf_path,
            pagesize=letter,
            rightMargin=54, leftMargin=54,
            topMargin=72, bottomMargin=54
        )

        title_style = ParagraphStyle(
            'PDFTitle_' + uuid.uuid4().hex[:8],
            fontName='Helvetica-Bold',
            fontSize=20,
            textColor=colors.HexColor('#0F172A'),
            spaceAfter=15,
            leading=24
        )

        meta_style = ParagraphStyle(
            'PDFMetadata_' + uuid.uuid4().hex[:8],
            fontName='Helvetica-Oblique',
            fontSize=10,
            textColor=colors.HexColor('#64748B'),
            spaceAfter=8,
            leading=12
        )

        story = []
        
        # Escape title safely
        escaped_title = html.escape(req.session_title)
        story.append(Paragraph(escaped_title, title_style))
        
        # Display generation timestamp
        timestamp_str = f"Generated: {get_ist_time_str()}"
        story.append(Paragraph(timestamp_str, meta_style))
        
        # Title separator line
        line_table = Table([['']], colWidths=[504], rowHeights=[2])
        line_table.setStyle(TableStyle([
            ('LINEBELOW', (0, 0), (-1, -1), 1.5, colors.HexColor('#B38728')),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
        ]))
        story.append(line_table)
        story.append(Spacer(1, 20))

        # Add all messages directly to the story with header bands to prevent truncation
        for msg in req.messages:
            # Create header band
            header_band = create_message_header_band(msg.role, msg.timestamp or "")
            story.append(header_band)
            story.append(Spacer(1, 8))
            
            # Parse markdown content to flowables (use full width of 504.0)
            msg_flowables = parse_markdown_to_flowables(msg.content, width=504.0)
            story.extend(msg_flowables)
            
            # Add citations if present
            citations_flowables = create_citations_block(msg.citations, width=504.0)
            if citations_flowables:
                story.extend(citations_flowables)
                
            story.append(Spacer(1, 18))

        doc.build(story, onFirstPage=add_header_footer, onLaterPages=add_header_footer)
        
        safe_time = get_filename_safe_ist_time_str()
        download_name = f"AI-Study-Session-Chat-{safe_time}.pdf"
        
        return FileResponse(
            path=pdf_path,
            filename=download_name,
            media_type="application/pdf"
        )
    except Exception as e:
        logger.error(f"PDF Chat Export error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF chat export: {str(e)}")

class LimitValidationRequest(BaseModel):
    filenames: List[str]
    tool: str # "flashcards" or "quiz"
    requested_count: int

@app.post("/api/validate-limit")
def validate_limit(req: LimitValidationRequest):
    """
    Estimates the maximum number of unique, high-quality flashcards or quiz questions
    that can be generated from the selected materials and validates the requested count.
    """
    if req.requested_count <= 0:
        raise HTTPException(status_code=400, detail="Count must be greater than zero.")
    if req.requested_count > 50:
        raise HTTPException(status_code=400, detail="Requested count exceeds maximum allowed limit (50).")

    if not req.filenames:
        return {"valid": True, "max_limit": 50, "message": ""}

    # 1. Similarity search to find contents outline, key concepts, index, or chapter descriptions
    context_clips = []
    try:
        for fn in req.filenames[:3]:
            docs = rag_service.search_similarity(
                query="table of contents outline index chapters key concepts main topics summaries", 
                k=4, 
                doc_filters=[fn]
            )
            if docs:
                context_clips.append(f"Document: {fn}\n" + "\n".join([d["content"] for d in docs]))
    except Exception as e:
        logger.error(f"Error during estimation search: {e}")

    context = "\n\n---\n\n".join(context_clips)
    if not context:
        max_est = 15
    else:
        prompt = (
            f"You are an expert academic text validator.\n"
            f"Analyze the content outlines and excerpts of the selected study materials: {', '.join(req.filenames)}.\n"
            f"Estimate the maximum number of unique, high-quality, non-repetitive conceptual QA flashcards (if tool is 'flashcards') "
            f"or multiple choice quiz questions (if tool is 'quiz') that can be generated from these materials.\n"
            f"Avoid generating low-quality, repetitive, generic, or filler cards. Be realistic.\n"
            f"Return ONLY a single integer representing this maximum limit (e.g. 12). Do not include any explanation, code blocks, or preamble.\n\n"
            f"--- MATERIAL EXCERPTS ---\n{context}"
        )
        try:
            raw_text = call_llm_with_fallback(prompt, temperature=0.1)
            raw_text = raw_text.strip()
            digits = "".join([c for c in raw_text if c.isdigit()])
            if digits:
                max_est = int(digits)
            else:
                max_est = 15
        except Exception as e:
            logger.error(f"Error calling LLM for validation estimation: {e}")
            max_est = 15

    max_est = max(5, min(max_est, 40))

    if req.requested_count > max_est:
        tool_label = "flashcards" if req.tool == "flashcards" else "questions"
        reason = f"Only {max_est} high-quality {tool_label} can be generated from the selected materials."
        return {
            "valid": False,
            "max_limit": max_est,
            "message": reason
        }
    
    return {
        "valid": True,
        "max_limit": max_est,
        "message": ""
    }
