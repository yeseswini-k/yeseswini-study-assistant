import sys
import os
import resource
import gc

sys.path.append(os.getcwd())

def get_memory():
    # Return memory in MB
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024

print(f"Initial Memory: {get_memory():.2f} MB")

modules = [
    ("fastapi", "from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header"),
    ("groq", "from groq import Groq, AsyncGroq"),
    ("reportlab", "import reportlab"),
    ("fitz", "import fitz"),
    ("pytesseract", "import pytesseract"),
    ("PIL", "from PIL import Image"),
    ("cv2", "import cv2"),
    ("numpy", "import numpy as np"),
    ("supabase", "from supabase import create_client, Client"),
    ("pypdf", "from pypdf import PdfReader"),
    ("langchain_text_splitters", "from langchain_text_splitters import RecursiveCharacterTextSplitter"),
]

for name, imp in modules:
    mem_before = get_memory()
    try:
        exec(imp)
        gc.collect()
        mem_after = get_memory()
        diff = mem_after - mem_before
        print(f"Imported {name} -> Memory: {mem_after:.2f} MB (+{diff:.2f} MB)")
    except Exception as e:
        print(f"Failed to import {name}: {e}")

# Now import main
mem_before = get_memory()
try:
    if os.path.exists("main.py"):
        import main
    else:
        import backend.main
    gc.collect()
    mem_after = get_memory()
    diff = mem_after - mem_before
    print(f"Imported main -> Memory: {mem_after:.2f} MB (+{diff:.2f} MB)")
except Exception as e:
    print(f"Failed to import main: {e}")

print("Checking if torch is imported...")
print("torch in sys.modules:", "torch" in sys.modules)

# Let's instantiate RAGService and see if that triggers torch import
print("\nInstantiating RAGService...")
mem_before = get_memory()
try:
    os.environ["HUGGINGFACE_API_KEY"] = "hf_test_key"
    if os.path.exists("rag_service.py"):
        from rag_service import RAGService
    else:
        from backend.rag_service import RAGService
    service = RAGService()
    mem_after = get_memory()
    diff = mem_after - mem_before
    print(f"RAGService instantiated -> Memory: {mem_after:.2f} MB (+{diff:.2f} MB)")
except Exception as e:
    print(f"Failed to instantiate RAGService: {e}")

print("Checking if torch is imported now...")
print("torch in sys.modules:", "torch" in sys.modules)
if "torch" in sys.modules:
    print("Which module loaded torch?")
    for mod_name, mod in list(sys.modules.items()):
        if mod and hasattr(mod, "__file__") and mod.__file__ and "torch" in mod.__file__:
            print(f"  - {mod_name}")
