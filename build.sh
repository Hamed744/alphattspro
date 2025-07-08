#!/bin/bash

echo "Installing Node.js dependencies..."
npm install

echo "Setting up Python virtual environment..."
# Check if python3 is available, otherwise use python
if command -v python3 &> /dev/null
then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null
then
    PYTHON_CMD="python"
else
    echo "Error: Python interpreter not found."
    exit 1
fi

# Create a virtual environment named 'venv'
$PYTHON_CMD -m venv venv

# Activate the virtual environment
source venv/bin/activate

echo "Installing Python dependencies into virtual environment..."
# Install dependencies using pip within the activated virtual environment
pip install -r requirements.txt

# Deactivate the virtual environment (optional, but good practice)
deactivate

echo "Build process completed."
