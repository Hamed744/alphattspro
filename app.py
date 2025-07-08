import os
import re
import struct
import time
import uuid
import shutil
import logging
import threading
import mimetypes  # <--- این خط اضافه شده است
from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from google import genai
from google.genai import types

try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False

# --- پیکربندی لاگینگ ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S')

# --- منطق مدیریت API Key (بدون تغییر) ---
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
        if not ALL_API_KEYS: return None, None
        key_to_use = ALL_API_KEYS[NEXT_KEY_INDEX % len(ALL_API_KEYS)]
        key_display_index = (NEXT_KEY_INDEX % len(ALL_API_KEYS)) + 1
        NEXT_KEY_INDEX += 1
        return key_to_use, key_display_index

# --- ثابت‌ها و توابع کمکی (بدون تغییر) ---
FIXED_MODEL_NAME = "gemini-2.5-flash-preview-tts"
DEFAULT_MAX_CHUNK_SIZE = 3800
DEFAULT_SLEEP_BETWEEN_REQUESTS = 8

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

# --- منطق تولید صدا با تلاش مجدد (بدون تغییر) ---
def generate_audio_chunk_with_retry(chunk_text, prompt_text, voice, temp, session_id):
    if not ALL_API_KEYS:
        logging.error(f"[{session_id}] ❌ هیچ کلید API برای تولید صدا در دسترس نیست.")
        return None
    for _ in range(len(ALL_API_KEYS)):
        selected_api_key, key_idx_display = get_next_api_key()
        if not selected_api_key: break
        logging.info(f"[{session_id}] ⚙️ تلاش برای تولید قطعه با کلید API شماره {key_idx_display} (...{selected_api_key[-4:]})")
        try:
            client = genai.Client(api_key=selected_api_key)
            final_text = f'"{prompt_text}"\n{chunk_text}' if prompt_text and prompt_text.strip() else chunk_text
            contents = [types.Content(role="user", parts=[types.Part.from_text(text=final_text)])]
            config = types.GenerateContentConfig(temperature=temp, response_modalities=["audio"],
                speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))))
            response = client.models.generate_content(model=FIXED_MODEL_NAME, contents=contents, config=config)
            if response.candidates and response.candidates[0].content and response.candidates[0].content.parts and response.candidates[0].content.parts[0].inline_data:
                logging.info(f"[{session_id}] ✅ قطعه با موفقیت توسط کلید شماره {key_idx_display} تولید شد.")
                return response.candidates[0].content.parts[0].inline_data
            else:
                logging.warning(f"[{session_id}] ⚠️ پاسخ API برای قطعه با کلید شماره {key_idx_display} بدون داده صوتی بود.")
        except Exception as e:
            logging.error(f"[{session_id}] ❌ خطا در تولید قطعه با کلید شماره {key_idx_display}: {e}.")
    return None

def core_generate_audio(text_input, prompt_input, selected_voice, temperature_val, session_id):
    logging.info(f"[{session_id}] 🚀 شروع فرآیند تولید صدا.")
    temp_dir = f"temp_{session_id}"
    os.makedirs(temp_dir, exist_ok=True)
    output_base_name = f"{temp_dir}/audio_session_{session_id}"
    if not text_input or not text_input.strip():
        raise ValueError("متن ورودی خالی است.")

    text_chunks = smart_text_split(text_input, DEFAULT_MAX_CHUNK_SIZE)
    if not text_chunks:
        raise ValueError("متن قابل پردازش به قطعات کوچکتر نیست.")

    generated_files = []
    final_audio_file = None
    try:
        for i, chunk in enumerate(text_chunks):
            logging.info(f"[{session_id}] 🔊 پردازش قطعه {i+1}/{len(text_chunks)}...")
            inline_data = generate_audio_chunk_with_retry(chunk, prompt_input, selected_voice, temperature_val, session_id)
            if inline_data:
                data_buffer = inline_data.data
                ext = mimetypes.guess_extension(inline_data.mime_type) or ".wav"
                if "audio/L" in inline_data.mime_type and ext == ".wav": 
                    data_buffer = convert_to_wav(data_buffer, inline_data.mime_type)
                if not ext.startswith("."): ext = "." + ext
                fpath = save_binary_file(f"{output_base_name}_part{i+1:03d}{ext}", data_buffer)
                if fpath: generated_files.append(fpath)
            else:
                raise Exception(f"فرآیند متوقف شد زیرا تولید قطعه {i+1} با تمام کلیدهای موجود ناموفق بود.")
            if i < len(text_chunks) - 1: time.sleep(DEFAULT_SLEEP_BETWEEN_REQUESTS)

        if not generated_files:
            raise Exception("هیچ فایل صوتی تولید نشد.")
        
        final_output_path = f"output_{session_id}.wav"
        if len(generated_files) > 1:
            if PYDUB_AVAILABLE and merge_audio_files_func(generated_files, final_output_path):
                final_audio_file = final_output_path
            else:
                shutil.move(generated_files[0], final_output_path)
                final_audio_file = final_output_path
        else:
            shutil.move(generated_files[0], final_output_path)
            final_audio_file = final_output_path
        
        logging.info(f"[{session_id}] ✅ فایل صوتی نهایی با موفقیت تولید شد: {os.path.basename(final_audio_file)}")
        return final_audio_file
    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            logging.info(f"[{session_id}] 🧹 دایرکتوری موقت '{temp_dir}' پاکسازی شد.")


# --- FastAPI App ---
app = FastAPI(title="Alpha TTS API")

# این بخش فایل‌های استاتیک شما (index.html, css, js) را سرو می‌کند
# تغییر: نام دایرکتوری را به "public" تغییر دادیم تا با ساختار فایل شما مطابقت داشته باشد.
app.mount("/static", StaticFiles(directory="public", html=True), name="static")


# مدل ورودی برای API
class TTSRequest(BaseModel):
    text: str
    prompt: str | None = ""
    speaker: str
    temperature: float

@app.post("/api/generate-audio")
async def generate_audio_endpoint(request: TTSRequest):
    session_id = str(uuid.uuid4())[:8]
    logging.info(f"[{session_id}] 🏁 درخواست جدید API دریافت شد.")
    try:
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="متن ورودی نمی‌تواند خالی باشد.")
        
        final_path = core_generate_audio(
            text_input=request.text,
            prompt_input=request.prompt,
            selected_voice=request.speaker,
            temperature_val=request.temperature,
            session_id=session_id
        )
        if final_path and os.path.exists(final_path):
            # پس از ارسال فایل، آن را پاک می‌کنیم تا فضا اشغال نشود
            return FileResponse(path=final_path, media_type='audio/wav', filename=os.path.basename(final_path), background=shutil.rmtree(os.path.dirname(final_path), ignore_errors=True))
        else:
            raise HTTPException(status_code=500, detail="خطا در تولید فایل صوتی در سرور.")
    except Exception as e:
        logging.error(f"[{session_id}] ❌ خطای کلی در API: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# این بخش صفحه اصلی (index.html) را در روت اصلی نمایش می‌دهد
@app.get("/", response_class=HTMLResponse)
@app.head("/", response_class=HTMLResponse) # <-- این خط را اضافه کنید
async def read_root():
    # ... (محتوای تابع تغییری نمی‌کند)
    # تغییر: مسیر فایل را به "public/index.html" تغییر دادیم
    with open("public/index.html", "r", encoding="utf-8") as f:
        html_content = f.read()
    return HTMLResponse(content=html_content)
