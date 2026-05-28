#!/bin/bash
echo "Starting Frontend Setup..."

# Navigate to project root directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR/frontend"

# Check if npm dependencies need to be installed
if [ ! -d "node_modules" ]; then
    echo "Installing node dependencies..."
    npm install
fi

# Run Vite dev server
echo "Launching Vite React application..."
npm run dev
