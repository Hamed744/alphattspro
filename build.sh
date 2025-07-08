#!/bin/bash
set -e # Exit immediately if a command fails

echo "--- Build Process (with ffmpeg) ---"

echo "1. Updating apt and installing ffmpeg..."
# Update package list and install ffmpeg
apt-get update -y && apt-get install -y ffmpeg

echo "2. Installing Node.js dependencies..."
npm install

echo "3. Installing Python dependencies globally for the container..."
# Use pip provided by the system python3
pip install -r requirements.txt

echo "--- Build Process Completed ---"
