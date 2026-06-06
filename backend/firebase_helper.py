import os
import shutil
import logging
import json
import firebase_admin
from firebase_admin import credentials, auth, storage
from pathlib import Path

logger = logging.getLogger(__name__)

# Resolve ROOT_DIR (parent of backend folder)
ROOT_DIR = Path(__file__).resolve().parent.parent

# Load configuration from environment variables
firebase_configured = False
firebase_bucket = None

firebase_config_str = os.getenv("FIREBASE_CONFIG_JSON")
firebase_bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET")

if firebase_config_str:
    try:
        cred_dict = json.loads(firebase_config_str)
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred, {
            'storageBucket': firebase_bucket_name
        })
        firebase_configured = True
        firebase_bucket = storage.bucket()
        logger.info("Firebase Admin initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize Firebase Admin: {e}")
else:
    logger.warning("FIREBASE_CONFIG_JSON not found. Running in LOCAL/DEVELOPMENT mode (no authentication required).")

def verify_token(authorization_header: str) -> dict:
    """
    Verifies Firebase JWT token. Returns decoded token with 'uid' and 'email'.
    If Firebase is not configured, returns local development user.
    """
    if not firebase_configured:
        return {"uid": "local-user", "email": "local-user@example.com"}

    if not authorization_header or not authorization_header.startswith("Bearer "):
        raise ValueError("Invalid authorization header format.")

    token = authorization_header.split("Bearer ")[1].strip()
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except Exception as e:
        logger.error(f"Token verification error: {e}")
        raise e

def sync_chroma_from_cloud(user_id: str, chroma_db_root: str):
    """
    Downloads user's Chroma database zip from Firebase Storage and extracts it locally.
    """
    if not firebase_configured or not firebase_bucket:
        return

    user_zip_path = os.path.join(chroma_db_root, f"{user_id}.zip")
    user_db_path = os.path.join(chroma_db_root, user_id)
    
    # Check if zip exists in cloud
    blob_path = f"users/{user_id}/chroma_db.zip"
    blob = firebase_bucket.blob(blob_path)
    
    if blob.exists():
        try:
            logger.info(f"Downloading vector database for user {user_id}...")
            os.makedirs(chroma_db_root, exist_ok=True)
            blob.download_to_filename(user_zip_path)
            
            # Remove existing local directory to overwrite
            if os.path.exists(user_db_path):
                shutil.rmtree(user_db_path)
                
            shutil.unpack_archive(user_zip_path, user_db_path, 'zip')
            os.remove(user_zip_path)
            logger.info(f"Vector database synced from cloud for user {user_id}.")
        except Exception as e:
            logger.error(f"Error syncing Chroma from cloud for user {user_id}: {e}")

def sync_chroma_to_cloud(user_id: str, chroma_db_root: str):
    """
    Zips user's local Chroma database folder and uploads it to Firebase Storage.
    """
    if not firebase_configured or not firebase_bucket:
        return

    user_db_path = os.path.join(chroma_db_root, user_id)
    if not os.path.exists(user_db_path):
        logger.warning(f"Local Chroma DB path {user_db_path} does not exist. Skipping sync.")
        return

    user_zip_base = os.path.join(chroma_db_root, f"{user_id}_temp")
    user_zip_path = f"{user_zip_base}.zip"
    
    try:
        logger.info(f"Archiving vector database for user {user_id}...")
        # Zip local database directory
        shutil.make_archive(user_zip_base, 'zip', user_db_path)
        
        # Upload to storage
        blob_path = f"users/{user_id}/chroma_db.zip"
        blob = firebase_bucket.blob(blob_path)
        blob.upload_from_filename(user_zip_path)
        
        # Clean up local zip
        if os.path.exists(user_zip_path):
            os.remove(user_zip_path)
        logger.info(f"Vector database uploaded to cloud for user {user_id}.")
    except Exception as e:
        logger.error(f"Error uploading Chroma to cloud for user {user_id}: {e}")

def sync_metadata_from_cloud(user_id: str, upload_dir: str) -> dict:
    """
    Downloads user's metadata JSON from Firebase Storage. Returns parsed dict.
    """
    if not firebase_configured or not firebase_bucket:
        return {}

    blob_path = f"users/{user_id}/docs_metadata.json"
    blob = firebase_bucket.blob(blob_path)
    
    if blob.exists():
        try:
            metadata_str = blob.download_as_text()
            return json.loads(metadata_str)
        except Exception as e:
            logger.error(f"Error downloading metadata for user {user_id}: {e}")
            return {}
    return {}

def sync_metadata_to_cloud(user_id: str, metadata: dict):
    """
    Uploads user's metadata JSON to Firebase Storage.
    """
    if not firebase_configured or not firebase_bucket:
        return

    try:
        blob_path = f"users/{user_id}/docs_metadata.json"
        blob = firebase_bucket.blob(blob_path)
        blob.upload_from_string(json.dumps(metadata, indent=4), content_type="application/json")
        logger.info(f"Metadata uploaded to cloud for user {user_id}.")
    except Exception as e:
        logger.error(f"Error uploading metadata for user {user_id}: {e}")

def upload_pdf_to_cloud(user_id: str, filename: str, file_bytes: bytes):
    """
    Uploads user's PDF/image file to Firebase Storage.
    """
    if not firebase_configured or not firebase_bucket:
        return

    try:
        blob_path = f"users/{user_id}/uploads/{filename}"
        blob = firebase_bucket.blob(blob_path)
        blob.upload_from_string(file_bytes, content_type="application/pdf" if filename.lower().endswith(".pdf") else "image/jpeg")
        logger.info(f"Uploaded {filename} to cloud for user {user_id}.")
    except Exception as e:
        logger.error(f"Failed to upload file {filename} for user {user_id}: {e}")

def delete_pdf_from_cloud(user_id: str, filename: str):
    """
    Deletes user's PDF/image file from Firebase Storage.
    """
    if not firebase_configured or not firebase_bucket:
        return

    try:
        blob_path = f"users/{user_id}/uploads/{filename}"
        blob = firebase_bucket.blob(blob_path)
        if blob.exists():
            blob.delete()
            logger.info(f"Deleted {filename} from cloud for user {user_id}.")
    except Exception as e:
        logger.error(f"Failed to delete file {filename} for user {user_id}: {e}")
