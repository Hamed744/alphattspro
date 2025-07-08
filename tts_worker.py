import base64
import mimetypes
import os
import re
import struct
import time
import uuid  # اضافه شد: برای ایجاد شناسه‌های منحصر به فرد
import shutil # اضافه شد: برای پاکسازی دایرکتوری‌ها
import json   # اضافه شد: برای دریافت ورودی و ارسال خروجی JSON
import sys    # اضافه شد: برای خواندن از stdin و نوشتن در stdout
import logging
import threading

# Import the Google Generative AI library components
import google.generativeai as genai
from google.generativeai import types # Ensure types is imported from genai

try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False

# --- START: پیکربندی لاگینگ ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
# --- END: پیکربندی لاگینگ ---

# --- START: منطق مدیریت API Key (بدون تغییر) ---
ALL_API_KEYS: list[str] = []
NEXT_KEY_INDEX: int = 0
KEY_LOCK: threading.Lock = threading.Lock()

def _init_api_keys():
    global ALL_API_KEYS
    all_keys_string = os.environ.get("ALL_GEMINI_API_KEYS")
    if all_keys_string:
        ALL_API_KEYS = [key.strip() for key in all_keys_string.split(',') if key.strip()]
    logging.info(f"✅ تعداد {len(ALL_API_KEYS)} کلید API جیمینای بارگذاری شد.")
    if not ALL_API_KEYS:
        logging.warning("⛔️ خطای حیاتی: هیچ Secret با نام ALL_GEMINI_API_KEYS یافت نشد!")

_init_api_keys()

def get_next_api_key():
    global NEXT_KEY_INDEX, ALL_API_KEYS, KEY_LOCK
    with KEY_LOCK:
        if not ALL_API_KEYS:
            return None, None
        key_to_use = ALL_API_KEYS[NEXT_KEY_INDEX % len(ALL_API_KEYS)]
        key_display_index = (NEXT_KEY_INDEX % len(ALL_API_KEYS)) + 1
        NEXT_KEY_INDEX += 1
        return key_to_use, key_display_index
# --- END: منطق مدیریت API Key ---

# --- ثابت‌ها ---
FIXED_MODEL_NAME = "gemini-2.5-flash-preview-tts"
DEFAULT_MAX_CHUNK_SIZE = 3800
DEFAULT_SLEEP_BETWEEN_REQUESTS = 8

# --- توابع کمکی (Helper Functions) ---
def save_binary_file(file_name, data):
    try:
        with open(file_name, "wb") as f: f.write(data)
        return file_name
    except Exception as e:
        logging.error(f"❌ خطا در ذخیره فایل {file_name}: {e}")
        return None

def convert_to_wav(audio_data: bytes, mime_type: str) -> bytes:
    parameters = parse_audio_mime_type(mime_type)
    bits_per_sample, rate = parameters["bits_per_sample"], parameters["rate"]
    num_channels, data_size = 1, len(audio_data)
    bytes_per_sample, block_align = bits_per_sample // 8, num_channels * (bits_per_sample // 8)
    byte_rate, chunk_size = rate * block_align, 36 + data_size
    header = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", chunk_size, b"WAVE", b"fmt ", 16, 1, num_channels, rate, byte_rate, block_align, bits_per_sample, b"data", data_size)
    return header + audio_data

def parse_audio_mime_type(mime_type: str) -> dict[str, int]:
    bits, rate = 16, 24000
    for param in mime_type.split(";"):
        param = param.strip()
        if param.lower().startswith("rate="):
            try: rate = int(param.split("=", 1)[1])
            except: pass
        elif param.startswith("audio/L"):
            try: bits = int(param.split("L", 1)[1])
            except: pass
    return {"bits_per_sample": bits, "rate": rate}

def smart_text_split(text, max_size=3800):
    if len(text) <= max_size: return [text]
    chunks, current_chunk = [], ""
    sentences = re.split(r'(?<=[.!?؟])\s+', text)
    for sentence in sentences:
        if len(current_chunk) + len(sentence) + 1 > max_size:
            if current_chunk: chunks.append(current_chunk.strip())
            current_chunk = sentence
            while len(current_chunk) > max_size:
                split_idx = next((i for i in range(max_size - 1, max_size // 2, -1) if current_chunk[i] in ['،', ',', ';', ':', ' ']), -1)
                part, current_chunk = (current_chunk[:split_idx+1], current_chunk[split_idx+1:]) if split_idx != -1 else (current_chunk[:max_size], current_chunk[max_size:])
                chunks.append(part.strip())
        else: current_chunk += (" " if current_chunk else "") + sentence
    if current_chunk: chunks.append(current_chunk.strip())
    final_chunks = [c for c in chunks if c]
    return final_chunks

def merge_audio_files_func(file_paths, output_path):
    if not PYDUB_AVAILABLE: logging.warning("⚠️ pydub برای ادغام در دسترس نیست."); return False
    try:
        combined = AudioSegment.empty()
        for i, fp in enumerate(file_paths):
            if os.path.exists(fp): combined += AudioSegment.from_file(fp) + (AudioSegment.silent(duration=150) if i < len(file_paths) - 1 else AudioSegment.empty())
            else: logging.warning(f"⚠️ فایل برای ادغام پیدا نشد: {fp}")
        combined.export(output_path, format="wav")
        return True
    except Exception as e: logging.error(f"❌ خطا در ادغام فایل‌های صوتی: {e}"); return False

# --- START: منطق تولید صدا با قابلیت تلاش مجدد ---
def generate_audio_chunk_with_retry(chunk_text, prompt_text, voice, temp, session_id):
    """
    یک قطعه صوتی را با قابلیت تلاش مجدد با کلیدهای مختلف API تولید می‌کند.
    """
    if not ALL_API_KEYS:
        logging.error(f"[{session_id}] ❌ هیچ کلید API برای تولید صدا در دسترس نیست.")
        return None

    for _ in range(len(ALL_API_KEYS)):
        selected_api_key, key_idx_display = get_next_api_key()
        if not selected_api_key:
            logging.warning(f"[{session_id}] ⚠️ get_next_api_key هیچ کلیدی برنگرداند.")
            break
        logging.info(f"[{session_id}] ⚙️ تلاش برای تولید قطعه با کلید API شماره {key_idx_display} (...{selected_api_key[-4:]})")
        try:
            genai.configure(api_key=selected_api_key)
            final_text = f'"{prompt_text}"\n{chunk_text}' if prompt_text and prompt_text.strip() else chunk_text
            
            # این همان بلاک کدی است که نیاز به اصلاح دارد:
            config = types.GenerationConfig( # Changed from types.GenerateContentConfig to types.GenerationConfig
                temperature=temp,
                response_mime_type="audio/wav",
                # speech_config را مستقیما به GenerativeModel.generate_content پاس می‌دهیم
                # و باید داخل SpeechConfig باشد.
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)
                    )
                )
            )

            response = genai.GenerativeModel(model_name=FIXED_MODEL_NAME).generate_content(
                contents=[{"role": "user", "parts": [{"text": final_text}]}],
                generation_config=config # پرانتز بسته اینجا اضافه شد
            )
            
            if response.candidates and response.candidates[0].content and response.candidates[0].content.parts and response.candidates[0].content.parts[0].inline_data:
                logging.info(f"[{session_id}] ✅ قطعه با موفقیت توسط کلید شماره {key_idx_display} تولید شد.")
                return response.candidates[0].content.parts[0].inline_data
            else:
                logging.warning(f"[{session_id}] ⚠️ پاسخ API برای قطعه با کلید شماره {key_idx_display} بدون داده صوتی بود.")
        except Exception as e:
            logging.error(f"[{session_id}] ❌ خطا در تولید قطعه با کلید شماره {key_idx_display}: {e}.")
    logging.error(f"[{session_id}] ❌ تمام کلیدهای API امتحان شدند اما هیچ‌کدام موفق به تولید قطعه نشدند.")
    return None

def main():
    # خواندن ورودی JSON از stdin
    input_data = json.loads(sys.stdin.read())
    text_input = input_data.get("text")
    prompt_input = input_data.get("prompt")
    selected_voice = input_data.get("speaker")
    temperature_val = input_data.get("temperature")
    session_id = input_data.get("session_id", str(uuid.uuid4())[:8]) # اگر session_id از Node.js نیامد، جدید بساز

    logging.info(f"[{session_id}] 🚀 شروع فرآیند تولید صدا.")
    
    temp_dir = f"temp_{session_id}"
    os.makedirs(temp_dir, exist_ok=True)
    
    output_base_name = os.path.join(temp_dir, f"audio_session_{session_id}")

    if not text_input or not text_input.strip():
        logging.error(f"[{session_id}] ❌ متن ورودی خالی است.")
        shutil.rmtree(temp_dir)
        sys.stdout.write(json.dumps({"success": False, "error": "متن ورودی نمی‌تواند خالی باشد."}))
        sys.exit(1)

    text_chunks = smart_text_split(text_input, DEFAULT_MAX_CHUNK_SIZE)
    if not text_chunks:
        logging.error(f"[{session_id}] ❌ متن قابل پردازش به قطعات کوچکتر نیست.")
        shutil.rmtree(temp_dir)
        sys.stdout.write(json.dumps({"success": False, "error": "متن قابل پردازش به قطعات کوچکتر نیست."}))
        sys.exit(1)

    generated_files = []
    try:
        for i, chunk in enumerate(text_chunks):
            logging.info(f"[{session_id}] 🔊 پردازش قطعه {i+1}/{len(text_chunks)}...")
            inline_data = generate_audio_chunk_with_retry(chunk, prompt_input, selected_voice, temperature_val, session_id)
            if inline_data:
                data_buffer = inline_data.data
                ext = ".wav" 
                
                fname_base = f"{output_base_name}_part{i+1:03d}"
                fpath = save_binary_file(f"{fname_base}{ext}", data_buffer)
                if fpath: 
                    generated_files.append(fpath)
                else:
                    logging.error(f"[{session_id}] ❌ موفق به ذخیره فایل برای قطعه {i+1} نشدیم.")
                    raise Exception(f"خطا در ذخیره فایل صوتی برای قطعه {i+1}.") 
            else:
                logging.error(f"[{session_id}] 🛑 فرآیند متوقف شد زیرا تولید قطعه {i+1} با تمام کلیدهای موجود ناموفق بود.")
                raise Exception(f"تولید قطعه {i+1} ناموفق بود. سرویس در دسترس نیست یا کلیدهای API مشکل دارند.")
            
            if i < len(text_chunks) - 1 and len(text_chunks) > 1: 
                time.sleep(DEFAULT_SLEEP_BETWEEN_REQUESTS)

        if not generated_files:
            logging.error(f"[{session_id}] ❌ هیچ فایل صوتی تولید نشد.")
            sys.stdout.write(json.dumps({"success": False, "error": "هیچ فایل صوتی تولید نشد."}))
            sys.exit(1)
        
        final_output_path = f"output_{session_id}.wav" 

        if len(generated_files) > 1:
            if PYDUB_AVAILABLE:
                if not merge_audio_files_func(generated_files, final_output_path):
                    logging.error(f"[{session_id}] ❌ ادغام فایل‌ها ناموفق بود. بازگشت به اولین قطعه.")
                    shutil.copy(generated_files[0], final_output_path)
            else: 
                logging.warning(f"[{session_id}] ⚠️ pydub در دسترس نیست. اولین قطعه صوتی ارائه می‌شود.")
                shutil.copy(generated_files[0], final_output_path)
        elif len(generated_files) == 1:
            shutil.copy(generated_files[0], final_output_path)
        
        if not os.path.exists(final_output_path):
            logging.error(f"[{session_id}] ❓ فایل نهایی پس از پردازش پیدا نشد.")
            sys.stdout.write(json.dumps({"success": False, "error": "فایل نهایی صوتی تولید نشد."}))
            sys.exit(1)
            
        logging.info(f"[{session_id}] ✅ فایل صوتی نهایی با موفقیت تولید شد: {final_output_path}")
        sys.stdout.write(json.dumps({"success": True, "audio_file_path": final_output_path}))

    except Exception as e:
        logging.error(f"[{session_id}] ❌ خطای کلی در فرآیند TTS: {e}")
        sys.stdout.write(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)
    finally:
        # پاکسازی دایرکتوری موقت و فایل‌های میانی
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            logging.info(f"[{session_id}] 🧹 دایرکتوری موقت '{temp_dir}' پاکسازی شد.")

if __name__ == "__main__":
    _init_api_keys()
    main()
