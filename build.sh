#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "--- Starting Build Process ---"

echo "1. Installing Node.js dependencies..."
npm install
echo "Node.js dependencies installed."

echo "2. Setting up Python virtual environment..."
# Determine the base python command
PYTHON_BASE_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_BASE_CMD="python3"
    echo "  Using python3 command."
elif command -v python &> /dev/null; then
    PYTHON_BASE_CMD="python"
    echo "  Using python command."
else
    echo "Error: Python interpreter (python3 or python) not found on system PATH."
    exit 1
fi

# Create a virtual environment named 'venv'
echo "  Creating virtual environment using '$PYTHON_BASE_CMD -m venv venv'..."
$PYTHON_BASE_CMD -m venv venv
echo "  Virtual environment 'venv' created."

# Ensure python3 symlink exists in venv/bin
# Some venvs create 'python' but not 'python3' directly.
# We need 'python3' to be consistent with server.js.
if [ -f venv/bin/python ] && [ ! -f venv/bin/python3 ]; then
    echo "  Creating 'python3' symlink in venv/bin..."
    ln -s "$(realpath venv/bin/python)" venv/bin/python3
    echo "  'python3' symlink created."
fi

# Check if the python executable exists in venv/bin (either python or python3)
if [ ! -f venv/bin/python3 ] && [ ! -f venv/bin/python ]; then
    echo "Error: Python executable not found inside 'venv/bin' after creation."
    exit 1
fi

echo "3. Installing Python dependencies into virtual environment..."
# Explicitly use the python from the venv for pip install
# Use -m pip to ensure the pip from the venv is used
# Using `python3` from venv because server.js is configured for it.
if [ -f venv/bin/python3 ]; then
    VENV_PYTHON_EXEC="venv/bin/python3"
elif [ -f venv/bin/python ]; then
    VENV_PYTHON_EXEC="venv/bin/python"
else
    echo "Error: Cannot find python executable inside venv for pip install."
    exit 1
fi

echo "  Using '$VENV_PYTHON_EXEC -m pip install -r requirements.txt'..."
$VENV_PYTHON_EXEC -m pip install -r requirements.txt
echo "Python dependencies installed."

echo "--- Build Process Completed Successfully ---"
