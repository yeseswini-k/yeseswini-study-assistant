import os
import shutil
import logging
import json
from supabase import create_client, Client
from pathlib import Path

logger = logging.getLogger(__name__)

# Load configuration from environment variables
supabase_configured = False
supabase_client = None
supabase_bucket_name = "study-assistant-assets"  # Default bucket

supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")  # Should be service_role secret key for backend storage admin

if supabase_url and supabase_key:
    try:
        supabase_client = create_client(supabase_url, supabase_key)
        supabase_configured = True
        logger.info("Supabase Client initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize Supabase: {e}")
else:
    logger.warning("SUPABASE_URL or SUPABASE_KEY not found. Running in LOCAL/DEVELOPMENT mode (no authentication required).")

def verify_token(authorization_header: str) -> dict:
    """
    Verifies Supabase access token (JWT). Returns user details.
    If Supabase is not configured, returns local development user.
    """
    if not supabase_configured or not supabase_client:
        return {"uid": "local-user", "email": "local-user@example.com"}

    if not authorization_header or not authorization_header.startswith("Bearer "):
        raise ValueError("Invalid authorization header format.")

    token = authorization_header.split("Bearer ")[1].strip()
    try:
        # Fetch user details using token to verify integrity
        user_response = supabase_client.auth.get_user(token)
        if not user_response or not user_response.user:
            raise ValueError("Invalid token: user not found.")
        user = user_response.user
        return {"uid": user.id, "email": user.email}
    except Exception as e:
        logger.error(f"Supabase Token verification error: {e}")
        raise e

def sync_chroma_from_cloud(user_id: str, chroma_db_root: str):
    """
    Downloads user's Chroma database zip from Supabase Storage and extracts it locally.
    """
    if not supabase_configured or not supabase_client:
        return

    user_zip_path = os.path.join(chroma_db_root, f"{user_id}.zip")
    user_db_path = os.path.join(chroma_db_root, user_id)
    
    blob_path = f"users/{user_id}/chroma_db.zip"
    
    try:
        logger.info(f"Downloading vector database for user {user_id} from Supabase...")
        
        # Check if file exists in bucket
        folder_path = f"users/{user_id}"
        files = supabase_client.storage.from_(supabase_bucket_name).list(folder_path)
        exists = any(f.get("name") == "chroma_db.zip" for f in files) if isinstance(files, list) else False
        
        if exists:
            # Download bytes
            file_bytes = supabase_client.storage.from_(supabase_bucket_name).download(blob_path)
            if file_bytes:
                os.makedirs(chroma_db_root, exist_ok=True)
                with open(user_zip_path, "wb") as f:
                    f.write(file_bytes)
                
                # Remove existing local directory to overwrite
                if os.path.exists(user_db_path):
                    shutil.rmtree(user_db_path)
                    
                shutil.unpack_archive(user_zip_path, user_db_path, 'zip')
                os.remove(user_zip_path)
                logger.info(f"Vector database synced from cloud for user {user_id}.")
        else:
            logger.info(f"No existing vector database found in cloud for user {user_id}.")
    except Exception as e:
        logger.error(f"Error syncing Chroma from cloud for user {user_id}: {e}")

def sync_chroma_to_cloud(user_id: str, chroma_db_root: str):
    """
    Zips user's local Chroma database folder and uploads it to Supabase Storage.
    """
    if not supabase_configured or not supabase_client:
        return

    user_db_path = os.path.join(chroma_db_root, user_id)
    if not os.path.exists(user_db_path):
        logger.warning(f"Local Chroma DB path {user_db_path} does not exist. Skipping sync.")
        return

    user_zip_base = os.path.join(chroma_db_root, f"{user_id}_temp")
    user_zip_path = f"{user_zip_base}.zip"
    blob_path = f"users/{user_id}/chroma_db.zip"
    
    try:
        logger.info(f"Archiving vector database for user {user_id}...")
        # Zip local database directory
        shutil.make_archive(user_zip_base, 'zip', user_db_path)
        
        # Read file bytes
        with open(user_zip_path, "rb") as f:
            file_bytes = f.read()
            
        logger.info(f"Uploading vector database for user {user_id} to Supabase...")
        # Upload with upsert (overwrite)
        try:
            supabase_client.storage.from_(supabase_bucket_name).upload(
                path=blob_path,
                file=file_bytes,
                file_options={"upsert": "true", "content-type": "application/zip"}
            )
        except Exception:
            supabase_client.storage.from_(supabase_bucket_name).update(
                path=blob_path,
                file=file_bytes,
                file_options={"content-type": "application/zip"}
            )
        
        # Clean up local zip
        if os.path.exists(user_zip_path):
            os.remove(user_zip_path)
        logger.info(f"Vector database uploaded to cloud for user {user_id}.")
    except Exception as e:
        logger.error(f"Error uploading Chroma to cloud for user {user_id}: {e}")

def sync_metadata_from_cloud(user_id: str, upload_dir: str) -> dict:
    """
    Downloads user's metadata JSON from Supabase Storage. Returns parsed dict.
    """
    if not supabase_configured or not supabase_client:
        return {}

    blob_path = f"users/{user_id}/docs_metadata.json"
    
    try:
        folder_path = f"users/{user_id}"
        files = supabase_client.storage.from_(supabase_bucket_name).list(folder_path)
        exists = any(f.get("name") == "docs_metadata.json" for f in files) if isinstance(files, list) else False
        
        if exists:
            metadata_bytes = supabase_client.storage.from_(supabase_bucket_name).download(blob_path)
            if metadata_bytes:
                return json.loads(metadata_bytes.decode("utf-8"))
    except Exception as e:
        logger.error(f"Error downloading metadata for user {user_id}: {e}")
    return {}

def sync_metadata_to_cloud(user_id: str, metadata: dict):
    """
    Uploads user's metadata JSON to Supabase Storage.
    """
    if not supabase_configured or not supabase_client:
        return

    blob_path = f"users/{user_id}/docs_metadata.json"
    metadata_bytes = json.dumps(metadata, indent=4).encode("utf-8")
    
    try:
        try:
            supabase_client.storage.from_(supabase_bucket_name).upload(
                path=blob_path,
                file=metadata_bytes,
                file_options={"upsert": "true", "content-type": "application/json"}
            )
        except Exception:
            supabase_client.storage.from_(supabase_bucket_name).update(
                path=blob_path,
                file=metadata_bytes,
                file_options={"content-type": "application/json"}
            )
        logger.info(f"Metadata uploaded to cloud for user {user_id}.")
    except Exception as e:
        logger.error(f"Error uploading metadata for user {user_id}: {e}")

def upload_pdf_to_cloud(user_id: str, filename: str, file_bytes: bytes):
    """
    Uploads user's PDF/image file to Supabase Storage.
    """
    if not supabase_configured or not supabase_client:
        return

    blob_path = f"users/{user_id}/uploads/{filename}"
    content_type = "application/pdf" if filename.lower().endswith(".pdf") else "image/jpeg"
    
    try:
        try:
            supabase_client.storage.from_(supabase_bucket_name).upload(
                path=blob_path,
                file=file_bytes,
                file_options={"upsert": "true", "content-type": content_type}
            )
        except Exception:
            supabase_client.storage.from_(supabase_bucket_name).update(
                path=blob_path,
                file=file_bytes,
                file_options={"content-type": content_type}
            )
        logger.info(f"Uploaded {filename} to cloud for user {user_id}.")
    except Exception as e:
        logger.error(f"Failed to upload file {filename} for user {user_id}: {e}")

def delete_pdf_from_cloud(user_id: str, filename: str):
    """
    Deletes user's PDF/image file from Supabase Storage.
    """
    if not supabase_configured or not supabase_client:
        return

    blob_path = f"users/{user_id}/uploads/{filename}"
    try:
        supabase_client.storage.from_(supabase_bucket_name).remove([blob_path])
        logger.info(f"Deleted {filename} from cloud for user {user_id}.")
    except Exception as e:
        logger.error(f"Failed to delete file {filename} for user {user_id}: {e}")
