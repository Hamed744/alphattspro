#!/bin/bash
set -e # Exit immediately if a command fails

echo "--- Build Process (Installing ffmpeg from URL) ---"

echo "1. Downloading and installing FFmpeg..."
# URL برای دانلود FFmpeg - این URL ممکن است نیاز به به‌روزرسانی داشته باشد
# این لینک برای Linux x64 است.
FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
FFMPEG_DIR="ffmpeg_static"

mkdir -p "$FFMPEG_DIR"
wget -O - "$FFMPEG_URL" | tar -xJ --strip-components=1 -C "$FFMPEG_DIR"
echo "FFmpeg downloaded and extracted to $FFMPEG_DIR."

# اطمینان حاصل می‌کنیم که ffmpeg در PATH برای زمان اجرا قرار می‌گیرد
# این کار با تنظیم متغیر محیطی PATH در تنظیمات Render تکمیل خواهد شد
# اما برای pip و هر ابزار build دیگر، بهتر است در اینجا هم اضافه شود.
export PATH="$PWD/$FFMPEG_DIR:$PATH"
echo "FFmpeg added to PATH for build process."

echo "2. Installing Node.js dependencies..."
npm install

echo "3. Installing Python dependencies globally for the container..."
pip install -r requirements.txt

echo "--- Build Process Completed ---"
