#!/bin/bash

# Navigate to project root directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Print banner
echo "============================================="
echo "        AI Study Assistant Pro - Launcher    "
echo "============================================="

# Ensure .env exists
if [ ! -f ".env" ]; then
    echo "Creating .env from example..."
    cp .env.example .env
fi

# Check if GROQ_API_KEY is configured
if grep -q "your_groq_api_key_here" ".env"; then
    echo "============================================="
    echo " WARNING: Please edit your .env file and set your GROQ_API_KEY."
    echo " Once updated, re-run this script to start the application."
    echo "============================================="
    exit 1
fi

# Trap to kill all background processes on exit
trap 'kill 0' EXIT

echo "Starting Backend in the background..."
bash start_backend.sh &
BACKEND_PID=$!

echo "Starting Frontend in the background..."
bash start_frontend.sh &
FRONTEND_PID=$!

# Wait for both background tasks
wait $BACKEND_PID $FRONTEND_PID
