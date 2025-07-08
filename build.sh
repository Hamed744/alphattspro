#!/bin/bash
set -e # Exit immediately if a command fails

echo "--- Build Process (Simplified) ---"
echo "1. Installing Node.js dependencies..."
npm install

echo "2. Installing Python dependencies globally for the container..."
# Use pip provided by the system python3
pip install -r requirements.txt

echo "--- Build Process Completed ---"
