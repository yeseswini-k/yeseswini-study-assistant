import os
from pathlib import Path
from dotenv import load_dotenv

# Resolve root path of the project (parent of backend folder)
ROOT_DIR = Path(__file__).resolve().parent.parent

# Load configuration from .env file
load_dotenv(dotenv_path=ROOT_DIR / ".env")

# Settings Configuration class
class Settings:
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    
    # Path configuration
    CHROMA_DB_PATH: str = os.getenv("CHROMA_DB_PATH", str(ROOT_DIR / "backend" / "chroma_db"))
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", str(ROOT_DIR / "backend" / "uploads"))
    
    # Server configuration
    BACKEND_HOST: str = os.getenv("BACKEND_HOST", "0.0.0.0")
    BACKEND_PORT: int = int(os.getenv("BACKEND_PORT", "8000"))
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:5173")

settings = Settings()

# Ensure directories exist
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
os.makedirs(settings.CHROMA_DB_PATH, exist_ok=True)
