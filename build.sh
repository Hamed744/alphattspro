#!/bin/bash

echo "Installing Node.js dependencies..."
npm install

echo "Setting up Python virtual environment..."
# Determine the base python command
PYTHON_BASE_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_BASE_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_BASE_CMD="python"
else
    echo "Error: Python interpreter not found on system PATH."
    exit 1
fi

# Create a virtual environment named 'venv'
$PYTHON_BASE_CMD -m venv venv

# Ensure python3 symlink exists in venv/bin
# Some venvs create 'python' but not 'python3' directly
# This ensures that 'venv/bin/python3' exists for server.js
if [ ! -f venv/bin/python3 ]; then
    echo "Creating python3 symlink in venv/bin..."
    ln -s "$(realpath venv/bin/python)" venv/bin/python3
fi

echo "Installing Python dependencies into virtual environment..."
# Explicitly use the python from the venv for pip install
# Use -m pip to ensure the pip from the venv is used
venv/bin/python3 -m pip install -r requirements.txt

echo "Build process completed."
