const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// **اصلاح کلیدی: همیشه از 'python3' سیستمی استفاده کن**
// چون build.sh پکیج‌ها را به صورت سراسری نصب می‌کند، دیگر نیازی به venv نیست.
const PYTHON_EXECUTABLE = 'python3';

console.log(`[Node.js] Using Python executable: ${PYTHON_EXECUTABLE}`);

app.post('/generate-audio', (req, res) => {
    const { text, prompt, speaker, temperature } = req.body;

    if (!text || text.trim() === '') {
        return res.status(400).json({ error: 'متن ورودی نمی‌تواند خالی باشد.' });
    }

    const sessionId = uuidv4().substring(0, 8);

    console.log(`[${sessionId}] 🚀 New request received for audio generation.`);
    console.log(`[${sessionId}] Text: "${text.substring(0, 50)}..."`);
    console.log(`[${sessionId}] Speaker: ${speaker}, Temperature: ${temperature}`);

    const pythonScriptPath = path.join(__dirname, 'tts_worker.py');

    // بررسی وجود فایل اسکریپت برای جلوگیری از خطاهای احتمالی
    if (!fs.existsSync(pythonScriptPath)) {
        console.error(`[${sessionId}] ❌ Error: Python script not found at ${pythonScriptPath}`);
        return res.status(500).json({ error: 'خطای داخلی سرور: اسکریپت پردازش پیدا نشد.' });
    }

    const inputData = {
        text: text,
        prompt: prompt,
        speaker: speaker,
        temperature: parseFloat(temperature),
        session_id: sessionId
    };

    let pythonOutput = '';
    let pythonError = '';

    const pythonProcess = spawn(PYTHON_EXECUTABLE, [pythonScriptPath], {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    // ارسال داده به پایتون
    pythonProcess.stdin.write(JSON.stringify(inputData));
    pythonProcess.stdin.end();

    // دریافت خروجی از پایتون
    pythonProcess.stdout.on('data', (data) => {
        pythonOutput += data.toString();
    });

    // دریافت خطا از پایتون
    pythonProcess.stderr.on('data', (data) => {
        pythonError += data.toString();
        // لاگ کردن خطای stderr به محض دریافت
        console.error(`[${sessionId}] Python stderr chunk: ${data.toString()}`);
    });

    // مدیریت بسته شدن فرآیند پایتون
    pythonProcess.on('close', (code) => {
        console.log(`[${sessionId}] Python script exited with code ${code}.`);

        if (code !== 0) {
            console.error(`[${sessionId}] Python script failed. Full stderr:`, pythonError);
            try {
                // تلاش برای پارس کردن خروجی JSON حتی در صورت خطا
                const errorParsed = JSON.parse(pythonOutput);
                return res.status(500).json({ error: errorParsed.error || 'خطای ناشناخته از سرویس پایتون.' });
            } catch (parseError) {
                // اگر خروجی JSON نبود، پیام خطای stderr را برگردان
                const errorMessage = pythonError || 'پاسخ نامشخص.';
                return res.status(500).json({ 
                    error: `خطا در سرویس تبدیل متن به صدا. لطفاً لاگ‌های سرور را بررسی کنید. پیام خطای پایتون: ${errorMessage}`
                });
            }
        }

        try {
            const result = JSON.parse(pythonOutput);
            if (result.success && result.audio_file_path) {
                const audioFilePath = path.join(__dirname, result.audio_file_path);
                
                // بررسی وجود فایل صوتی قبل از ارسال
                if (!fs.existsSync(audioFilePath)) {
                    console.error(`[${sessionId}] ❌ Error: Generated audio file not found at ${audioFilePath}`);
                    return res.status(500).json({ error: 'خطای داخلی سرور: فایل صوتی تولید شده یافت نشد.' });
                }

                console.log(`[${sessionId}] ✅ Audio file generated: ${audioFilePath}`);
                res.sendFile(audioFilePath, (err) => {
                    if (err) {
                        console.error(`[${sessionId}] ❌ Error sending audio file:`, err);
                    }
                    // پاک کردن فایل پس از ارسال
                    fs.unlink(audioFilePath, (unlinkErr) => {
                        if (unlinkErr) console.error(`[${sessionId}] 🧹 Error cleaning up temp file:`, unlinkErr);
                        else console.log(`[${sessionId}] 🧹 Temp file deleted: ${audioFilePath}`);
                    });
                });
            } else {
                console.error(`[${sessionId}] ❌ Python script returned success=false. Error:`, result.error);
                res.status(500).json({ error: result.error || 'فایل صوتی تولید نشد یا خطای ناشناخته رخ داد.' });
            }
        } catch (parseError) {
            console.error(`[${sessionId}] ❌ JSON.parse error from Python stdout:`, parseError);
            console.error(`[${sessionId}] Raw Python stdout:`, pythonOutput);
            res.status(500).json({ error: 'خطا در پردازش پاسخ از سرویس پایتون (پاسخ نامعتبر است).' });
        }
    });

    // مدیریت خطای اجرای خود فرآیند
    pythonProcess.on('error', (err) => {
        console.error(`[${sessionId}] ❌ Failed to start Python process:`, err);
        if (err.code === 'ENOENT') {
            res.status(500).json({ error: `خطا در اجرای سرویس پایتون: مفسر '${PYTHON_EXECUTABLE}' پیدا نشد.` });
        } else {
            res.status(500).json({ error: `خطای ناشناخته در اجرای سرویس پایتون: ${err.message}` });
        }
    });
});

// Fallback برای تمام مسیرهای دیگر
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// شروع سرور
app.listen(PORT, () => {
    console.log(`Node.js server listening on port ${PORT}`);
    console.log(`Access your application at: http://localhost:${PORT} (or your Render.com URL)`);
});
