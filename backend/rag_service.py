import os
import re
from typing import List, Dict, Any
from pypdf import PdfReader
from langchain_text_splitters import RecursiveCharacterTextSplitter
try:
    from backend.config import settings
except (ModuleNotFoundError, ImportError):
    from config import settings

def sanitize_chunk_text(text: str) -> str:
    if not text:
        return ""
    
    # 1. Remove RAG tags like "[Topic: ...] (Type: ...)"
    text = re.sub(r'\[Topic:\s*[^\]]+\]\s*\(Type:\s*[^)]+\)', '', text)
    
    # 2. Remove separator lines
    text = re.sub(r'---+\s*SEMANTIC RECONSTRUCTED STUDY NOTE\s*---+', '', text)
    text = re.sub(r'---+\s*ORIGINAL OCR\s*\(RAW CONTEXT\)\s*---+', '', text)
    
    # 3. Remove metadata keys
    patterns_to_remove = [
        r'\bchunk_\d+\b',
        r'\bsource_id:',
        r'\bmetadata:',
        r'\bOCR_CONFIDENCE\b',
        r'\bpage_ref:',
        r'\bembedded_at:',
        r'\bvector_score:',
        r'\bingestion_time:',
        r'\bOCR Quality:',
        r'\bAI Reconstruction:',
        r'\bSemantic Quality:',
        r'\breconstruction_confidence:',
        r'\bsemantic_quality_score:'
    ]
    for pattern in patterns_to_remove:
        text = re.sub(pattern, '', text, flags=re.IGNORECASE)
        
    # 4. Remove date patterns: e.g. [07/01/2025] or dates like 07/01/2025 3 or 07-01-2025 or 2025-01-07
    text = re.sub(r'\[?\b\d{2}[-/\.]\d{2}[-/\.]\d{4}\b\]?(\s+\d+)?', '', text)
    text = re.sub(r'\[?\b\d{4}[-/\.]\d{2}[-/\.]\d{2}\b\]?(\s+\d+)?', '', text)
    
    # 5. Remove standard times: HH:MM:SS
    text = re.sub(r'\b\d{1,2}:\d{2}(:\d{2})?(\s*(AM|PM|am|pm))?\b', '', text)
    
    # 6. Clean up empty/semi-empty brackets and trailing punctuation in brackets
    text = re.sub(r'\[\s*,\s*\]', '', text)
    text = re.sub(r'\[\s*\]', '', text)
    text = re.sub(r',\s*\]', ']', text)
    text = re.sub(r'\[\s*,', '[', text)
    
    # Clean up double newlines and extra spaces
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

class RAGService:
    def __init__(self):
        hf_api_key = os.getenv("HUGGINGFACE_API_KEY")
        if hf_api_key:
            print("Initializing Hugging Face Inference API Embeddings...")
            from langchain_community.embeddings import HuggingFaceInferenceAPIEmbeddings
            self.embeddings = HuggingFaceInferenceAPIEmbeddings(
                api_key=hf_api_key,
                model_name="sentence-transformers/all-MiniLM-L6-v2"
            )
        else:
            raise RuntimeError(
                "CRITICAL ERROR: HUGGINGFACE_API_KEY environment variable is not set. "
                "The Hugging Face Inference API is required to run lightweight embeddings. "
                "To prevent Out-Of-Memory (OOM) crashes, local model fallback is disabled. "
                "Please configure HUGGINGFACE_API_KEY in your environment variables (e.g. on Render dashboard)."
            )
        self.user_stores = {}

    def get_user_vectorstore(self, user_id: str) -> "Chroma":
        if user_id not in self.user_stores:
            from backend.supabase_helper import sync_chroma_from_cloud
            sync_chroma_from_cloud(user_id, settings.CHROMA_DB_PATH)
            
            user_db_path = os.path.join(settings.CHROMA_DB_PATH, user_id)
            os.makedirs(user_db_path, exist_ok=True)
            from langchain_community.vectorstores import Chroma
            self.user_stores[user_id] = Chroma(
                persist_directory=user_db_path,
                embedding_function=self.embeddings,
                collection_name=f"study_collection_{user_id}"
            )
        return self.user_stores[user_id]

    def persist_user_vectorstore(self, user_id: str):
        if user_id in self.user_stores:
            self.user_stores[user_id].persist()
            from backend.supabase_helper import sync_chroma_to_cloud
            sync_chroma_to_cloud(user_id, settings.CHROMA_DB_PATH)

    def process_and_index_pdf(self, file_path: str, filename: str, chunk_size: int = 1000, chunk_overlap: int = 200, session_id: str = None, upload_type: str = "typed_pdf", source_type: str = "pdf", ocr_flag: bool = False, user_id: str = "local-user") -> Dict[str, Any]:
        """
        Reads a PDF, splits text into chunks, and indexes it in ChromaDB with metadata.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found at {file_path}")

        # Extract text page by page with pypdf
        reader = PdfReader(file_path)
        documents_data = []
        
        for page_idx, page in enumerate(reader.pages):
            text = page.extract_text()
            if text and text.strip():
                documents_data.append({
                    "text": text,
                    "metadata": {
                        "source": filename,
                        "filename": filename,
                        "page": page_idx + 1,
                        "session_id": session_id or "global",
                        "upload_type": upload_type,
                        "source_type": source_type,
                        "ocr_flag": ocr_flag
                    }
                })

        if not documents_data:
            return {"status": "error", "message": "No text could be extracted from PDF."}

        # Chunk the text
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len
        )

        texts = []
        metadatas = []
        
        for doc in documents_data:
            chunks = text_splitter.split_text(doc["text"])
            for chunk in chunks:
                texts.append(chunk)
                metadatas.append(doc["metadata"])

        # Add to vector database in small batches to prevent memory spikes / OOM crashes on free tiers (512MB RAM)
        if texts:
            user_vectorstore = self.get_user_vectorstore(user_id)
            batch_size = 16
            for i in range(0, len(texts), batch_size):
                batch_texts = texts[i:i + batch_size]
                batch_metadatas = metadatas[i:i + batch_size]
                user_vectorstore.add_texts(texts=batch_texts, metadatas=batch_metadatas)
                import gc
                gc.collect()
            
            self.persist_user_vectorstore(user_id)
            return {
                "status": "success",
                "chunks_count": len(texts),
                "pages_count": len(reader.pages)
            }
        
        return {"status": "error", "message": "No text chunks generated."}

    def index_text(self, text: str, filename: str, chunk_size: int = 1000, chunk_overlap: int = 200, session_id: str = None, upload_type: str = "text", source_type: str = "text", ocr_flag: bool = False, user_id: str = "local-user") -> Dict[str, Any]:
        """
        Parses page tags from text, splits into chunks, and indexes it in ChromaDB with metadata.
        """
        import re
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
                
        # Chunk text page by page
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len
        )
        
        texts = []
        metadatas = []
        
        for doc in pages_data:
            chunks = text_splitter.split_text(doc["text"])
            for chunk in chunks:
                texts.append(chunk)
                metadatas.append({
                    "source": filename,
                    "filename": filename,
                    "page": doc["page"],
                    "session_id": session_id or "global",
                    "upload_type": upload_type,
                    "source_type": source_type,
                    "ocr_flag": ocr_flag
                })
                
        # Add to vector database in small batches to prevent memory spikes / OOM crashes on free tiers (512MB RAM)
        if texts:
            user_vectorstore = self.get_user_vectorstore(user_id)
            batch_size = 16
            for i in range(0, len(texts), batch_size):
                batch_texts = texts[i:i + batch_size]
                batch_metadatas = metadatas[i:i + batch_size]
                user_vectorstore.add_texts(texts=batch_texts, metadatas=batch_metadatas)
                import gc
                gc.collect()
            
            self.persist_user_vectorstore(user_id)
            return {
                "status": "success",
                "chunks_count": len(texts),
                "pages_count": max(doc["page"] for doc in pages_data) if pages_data else 1
            }
            
        return {"status": "error", "message": "No text chunks generated."}

    def index_structured_text(self, filename: str, text: str, analysis: dict, ocr_confidence: float = 100.0, chunk_size: int = 1000, chunk_overlap: int = 200, session_id: str = None, upload_type: str = "image", source_type: str = "image", ocr_flag: bool = True, user_id: str = "local-user") -> dict:
        """
        Splits text by its semantic sections from the LLM analysis and indexes them with structured metadata and rich hybrid text.
        """
        import re
        import json
        from langchain_text_splitters import RecursiveCharacterTextSplitter
        
        reconstruction_confidence = analysis.get("reconstruction_confidence", 80)
        semantic_quality_score = analysis.get("semantic_quality_score", 80)
        sections = analysis.get("sections", [])
        
        if not sections:
            # Fallback if no sections extracted
            sections = [{
                "heading": "Main Content",
                "section_type": "explanation",
                "original_ocr": text,
                "reconstructed_content": text,
                "summary": "Extracted text content from document.",
                "concepts": ["General Study Content"],
                "keywords": ["study", "notes"],
                "glossary": {},
                "exam_questions": [],
                "formulas": []
            }]
            
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len
        )
        
        texts = []
        metadatas = []
        
        # Identify pages from text if any
        # We can map each section to a page by tracking which page marker was seen last
        page_markers = list(re.finditer(r'---\s*Page\s+(\d+)\s*---', text))
        
        for section in sections:
            reconstructed_content = section.get("reconstructed_content", section.get("content", "")).strip()
            if not reconstructed_content:
                continue
                
            sec_heading = section.get("heading", "Untitled Section")
            sec_type = section.get("section_type", "explanation")
            original_ocr = section.get("original_ocr", "").strip() or reconstructed_content
            summary = section.get("summary", "").strip()
            
            # Format and sanitize metadata fields
            concepts_val = section.get("concepts", [])
            concepts_str = ",".join(concepts_val) if isinstance(concepts_val, list) else str(concepts_val)
            
            keywords_val = section.get("keywords", [])
            keywords_str = ",".join(keywords_val) if isinstance(keywords_val, list) else str(keywords_val)
            
            glossary_val = section.get("glossary", {})
            glossary_str = json.dumps(glossary_val) if isinstance(glossary_val, dict) else str(glossary_val)
            
            exam_questions_val = section.get("exam_questions", [])
            exam_questions_str = ",".join(exam_questions_val) if isinstance(exam_questions_val, list) else str(exam_questions_val)
            
            formulas_val = section.get("formulas", [])
            formulas_str = ",".join([str(f) for f in formulas_val]) if isinstance(formulas_val, list) else str(formulas_val)
            
            # Find page for this section by finding the last page marker before this section content in the full text
            page_num = 1
            if page_markers:
                idx = text.find(reconstructed_content[:50]) if len(reconstructed_content) > 50 else text.find(reconstructed_content)
                if idx != -1:
                    for marker in page_markers:
                        if marker.start() <= idx:
                            page_num = int(marker.group(1))
                        else:
                            break
                            
            # Split the reconstructed section content if it exceeds chunk_size
            chunks = text_splitter.split_text(reconstructed_content)
            for chunk in chunks:
                # Construct the enriched hybrid text that will be embedded
                rich_chunk = (
                    f"[Topic: {sec_heading}] (Type: {sec_type})\n"
                    f"--- SEMANTIC RECONSTRUCTED STUDY NOTE ---\n{chunk}\n\n"
                )
                if summary:
                    rich_chunk += f"Summary: {summary}\n"
                if concepts_str:
                    rich_chunk += f"Concepts: {concepts_str}\n"
                if keywords_str:
                    rich_chunk += f"Keywords: {keywords_str}\n"
                if glossary_str and glossary_str != "{}":
                    rich_chunk += f"Glossary: {glossary_str}\n"
                if exam_questions_str:
                    rich_chunk += f"Likely Exam Prep: {exam_questions_str}\n"
                
                rich_chunk += f"\n--- ORIGINAL OCR (RAW CONTEXT) ---\n{original_ocr}\n"
                
                texts.append(rich_chunk)
                metadatas.append({
                    "source": filename,
                    "filename": filename,
                    "page": page_num,
                    "section_type": sec_type,
                    "heading": sec_heading,
                    "formulas": formulas_str,
                    "concepts": concepts_str,
                    "keywords": keywords_str,
                    "exam_questions": exam_questions_str,
                    "ocr_confidence": float(ocr_confidence),
                    "reconstruction_confidence": float(reconstruction_confidence),
                    "semantic_quality_score": float(semantic_quality_score),
                    "session_id": session_id or "global",
                    "upload_type": upload_type,
                    "source_type": source_type,
                    "ocr_flag": ocr_flag
                })
                
        # Add to vector database in small batches to prevent memory spikes / OOM crashes on free tiers (512MB RAM)
        if texts:
            user_vectorstore = self.get_user_vectorstore(user_id)
            batch_size = 16
            for i in range(0, len(texts), batch_size):
                batch_texts = texts[i:i + batch_size]
                batch_metadatas = metadatas[i:i + batch_size]
                user_vectorstore.add_texts(texts=batch_texts, metadatas=batch_metadatas)
                import gc
                gc.collect()
            
            self.persist_user_vectorstore(user_id)
            return {
                "status": "success",
                "chunks_count": len(texts),
                "pages_count": max([m["page"] for m in metadatas]) if metadatas else 1
            }
            
        return {"status": "error", "message": "No text chunks generated."}

    def search_similarity(self, query: str, k: int = 4, doc_filters: List[str] = None, user_id: str = "local-user") -> List[Dict[str, Any]]:
        """
        Search similarity using query and return match chunks with score.
        Upgraded with hybrid retrieval, metadata filtering, and OCR confidence weighting.
        """
        search_filter = None
        if doc_filters and len(doc_filters) > 0:
            if len(doc_filters) == 1:
                search_filter = {
                    "$or": [
                        {"source": doc_filters[0]},
                        {"filename": doc_filters[0]}
                    ]
                }
            else:
                search_filter = {
                    "$or": [
                        {"source": {"$in": doc_filters}},
                        {"filename": {"$in": doc_filters}}
                    ]
                }

        # Fetch more candidates for reranking (e.g., k * 3)
        candidate_k = max(k * 3, 12)
        user_vectorstore = self.get_user_vectorstore(user_id)
        results = user_vectorstore.similarity_search_with_score(
            query, 
            k=candidate_k, 
            filter=search_filter
        )

        if not results:
            return []

        # Analyze query intent
        query_lower = query.lower()
        is_formula_query = any(w in query_lower for w in ["formula", "equation", "theorem", "math", "derive", "integral", "derivative", "matrix"])
        is_definition_query = any(w in query_lower for w in ["define", "definition", "meaning", "what is", "glossary", "term"])

        formatted_results = []
        for doc, distance in results:
            content = doc.page_content
            metadata = doc.metadata
            
            # 1. Map distance (lower is closer) to a similarity score (0.0 to 1.0)
            vector_sim = 1.0 / (1.0 + distance)
            
            # 2. Term overlap (Keyword similarity)
            query_words = set(re.findall(r'\w+', query_lower))
            doc_words = set(re.findall(r'\w+', content.lower()))
            overlap = 0.0
            if query_words:
                overlap = len(query_words.intersection(doc_words)) / len(query_words)
                
            # Hybrid score (combination of vector search and keyword match)
            hybrid_score = vector_sim * 0.7 + overlap * 0.3
            
            # 3. Quality weighting (Default to 100% for typed/non-OCR documents)
            ocr_conf = metadata.get("ocr_confidence", 100.0)
            recon_conf = metadata.get("reconstruction_confidence", 100.0)
            sem_score = metadata.get("semantic_quality_score", 100.0)
            
            # Calculate quality weight (0.0 to 1.0)
            quality_weight = (ocr_conf / 100.0) * 0.4 + (recon_conf / 100.0) * 0.4 + (sem_score / 100.0) * 0.2
            
            # 4. Intent Boost
            sec_type = metadata.get("section_type", "explanation")
            boost = 1.0
            if is_formula_query and sec_type == "formula":
                boost = 1.3
            elif is_definition_query and sec_type == "definition":
                boost = 1.3
                
            # 5. Metadata Field Boost
            metadata_boost = 1.0
            concepts_str = metadata.get("concepts", "").lower()
            concepts_words = set(re.findall(r'\w+', concepts_str))
            if query_words.intersection(concepts_words):
                metadata_boost += 0.15
                
            keywords_str = metadata.get("keywords", "").lower()
            keywords_words = set(re.findall(r'\w+', keywords_str))
            if query_words.intersection(keywords_words):
                metadata_boost += 0.10
                
            heading_str = metadata.get("heading", "").lower()
            heading_words = set(re.findall(r'\w+', heading_str))
            if query_words.intersection(heading_words):
                metadata_boost += 0.15
                
            # Final combined score (higher is better)
            final_score = hybrid_score * quality_weight * boost * metadata_boost
            
            # Sanitize content to remove metadata pollution
            sanitized_content = sanitize_chunk_text(content)
            
            formatted_results.append({
                "content": sanitized_content,
                "metadata": metadata,
                "score": final_score,
                "raw_distance": distance
            })

        # Sort candidate chunks descending by final_score
        formatted_results.sort(key=lambda x: x["score"], reverse=True)
        
        # Return top k results
        return formatted_results[:k]

    def search_all_documents(self, query: str, k: int = 10, user_id: str = "local-user") -> List[Dict[str, Any]]:
        """
        General retrieval for search matching documents without filters.
        """
        return self.search_similarity(query, k=k, user_id=user_id)

    def delete_document(self, filename: str, user_id: str = "local-user") -> bool:
        """
        Deletes chunks matching the filename source from the DB.
        """
        try:
            user_vectorstore = self.get_user_vectorstore(user_id)
            # chroma allows deleting by metadata matches
            collection = user_vectorstore._collection
            collection.delete(where={"source": filename})
            self.persist_user_vectorstore(user_id)
            return True
        except Exception as e:
            print(f"Error deleting document {filename} for user {user_id}: {e}")
            return False

    def clear_all(self, user_id: str = "local-user") -> bool:
        """
        Clears all items in Chroma DB.
        """
        try:
            user_vectorstore = self.get_user_vectorstore(user_id)
            user_vectorstore.delete_collection()
            # Recreate collection
            user_db_path = os.path.join(settings.CHROMA_DB_PATH, user_id)
            from langchain_community.vectorstores import Chroma
            self.user_stores[user_id] = Chroma(
                persist_directory=user_db_path,
                embedding_function=self.embeddings,
                collection_name=f"study_collection_{user_id}"
            )
            self.persist_user_vectorstore(user_id)
            return True
        except Exception as e:
            print(f"Error clearing vector database for user {user_id}: {e}")
            return False

rag_service = RAGService()
