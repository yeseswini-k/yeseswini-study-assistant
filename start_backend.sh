#!/bin/bash
echo "Starting Backend Setup..."

# Navigate to project root directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Check for virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "Installing Python dependencies (this might take a minute)..."
pip install --upgrade pip
pip install -r requirements.txt

# Create necessary folders
mkdir -p backend/uploads
mkdir -p backend/chroma_db

# Load environment variables
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
else
    echo "WARNING: .env file not found. Copying .env.example..."
    cp .env.example .env
fi

# Run the backend
echo "Launching FastAPI server..."
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
