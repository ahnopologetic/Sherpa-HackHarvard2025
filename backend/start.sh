#!/bin/bash
# Start script for Sherpa API

echo "Starting Sherpa API..."
echo "====================="

# Activate virtual environment if not already activated
if [[ -z "${VIRTUAL_ENV}" ]]; then
    echo "Activating virtual environment..."
    source .venv/bin/activate
fi

# Check if dependencies are installed
if ! command -v uvicorn &> /dev/null; then
    echo "Installing dependencies..."
    uv sync
fi

# Start the server
echo "Starting server on http://${HOST:-0.0.0.0}:${PORT:-8000}"
echo "API Docs available at http://localhost:${PORT:-8000}/docs"
echo "====================="

python app.py

