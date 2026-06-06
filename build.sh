#!/usr/bin/env bash
# exit on error
set -o errexit

echo "Starting build script..."

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

echo "Optimizing environment: uninstalling heavy unused ML libraries (torch, transformers, sentence-transformers)..."
pip uninstall -y torch sentence-transformers transformers

echo "Build script completed successfully!"
