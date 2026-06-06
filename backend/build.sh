#!/usr/bin/env bash
# exit on error
set -o errexit

echo "Starting build script from backend directory..."

# Install dependencies (since we are inside backend, requirements.txt is in the parent directory)
pip install --upgrade pip
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
elif [ -f "../requirements.txt" ]; then
    pip install -r ../requirements.txt
fi

echo "Optimizing environment: uninstalling heavy unused ML libraries (torch, transformers, sentence-transformers)..."
pip uninstall -y torch sentence-transformers transformers

echo "Build script completed successfully!"
