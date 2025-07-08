// server.js
const express = require('express');
const path = require('path');
const { spawn } = require('child_process'); // برای اجرای اسکریپت پایتون
const fs = require('fs'); // برای مدیریت فایل‌ها
const { v4: uuidv4 } = require('uuid'); // برای تولید شناسه‌های منحصر به فرد

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware برای سرو کردن فایل‌های استاتیک از دایرکتوری 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Middleware برای پردازش بدنه درخواست‌های JSON
app.use(express.json());

// **مسیر مفسر پایتون در محیط مجازی**
// این بخش تلاش می‌کند مفسر پایتون را در venv/bin/python3 یا venv/bin/python پیدا کند.
// اگر پیدا نشد، به python3 سیستمی برمی‌گردد (که Render معمولا فراهم می‌کند).
let PYTHON_EXECUTABLE;
const venvBinPath = path.join(__dirname, 'venv', 'bin');

if (fs.existsSync(path.join(venvBinPath, 'python3'))) {
    PYTHON_EXECUTABLE = path.join(venvBinPath, 'python3');
} else if (fs.existsSync(path.join(venvBinPath, 'python'))) {
    PYTHON_EXECUTABLE = path.join(venvBinPath, 'python');
} else {
    // Fallback to system-wide python3 if venv executable is not found.
    // This might happen if venv creation failed or python executable name is different.
    console.warn("Python executable not found in venv. Falling back to system python3.");
    PYTHON_EXECUTABLE = 'python3';
}

console.log(`Using Python executable: ${PYTHON_EXECUTABLE}`);


// API Endpoint جدید برای تبدیل متن به صدا
app.post('/generate-audio', (req, res) => {
    const { text, prompt, speaker, temperature } = req.body;

    if (!text || text.trim() === '') {
        return res.status(400).json({ error: 'متن ورودی نمی‌تواند خالی باشد.' });
    }

    const sessionId = uuidv4().substring(0, 8); // یک شناسه جلسه کوتاه برای لاگ‌ها

    console.log(`[${sessionId}] 🚀 درخواست جدید برای تولید صدا دریافت شد.`);
    console.log(`[${sessionId}] متن: "${text.substring(0, Math.min(text.length, 50))}..."`); // نمایش حداکثر 50 کاراکتر
    console.log(`[${sessionId}] گوینده: ${speaker}, دما: ${temperature}`);

    // مسیر اسکریپت پایتون
    const pythonScriptPath = path.join(__dirname, 'tts_worker.py');

    // اطلاعات ورودی برای اسکریپت پایتون
    const inputData = {
        text: text,
        prompt: prompt,
        speaker: speaker,
        temperature: temperature,
        session_id: sessionId
    };

    let pythonOutput = '';
    let pythonError = '';

    const pythonProcess = spawn(PYTHON_EXECUTABLE, [pythonScriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
    });

    // نوشتن داده‌ها به stdin اسکریپت پایتون
    pythonProcess.stdin.write(JSON.stringify(inputData));
    pythonProcess.stdin.end(); // بستن stdin پس از ارسال داده

    // گوش دادن به stdout اسکریپت پایتون
    pythonProcess.stdout.on('data', (data) => {
        pythonOutput += data.toString();
    });

    // گوش دادن به stderr اسکریپت پایتون
    pythonProcess.stderr.on('data', (data) => {
        pythonError += data.toString();
        // Log stderr directly, as it often contains useful debugging info from Python
        console.error(`[${sessionId}] Python stderr: ${data.toString().trim()}`);
    });

    // گوش دادن به رویداد بسته شدن اسکریپت پایتون
    pythonProcess.on('close', (code) => {
        console.log(`[${sessionId}] اسکریپت پایتون با کد خروج ${code} بسته شد.`);

        // Log full python output for debugging
        if (pythonOutput) {
            console.log(`[${sessionId}] Python stdout: ${pythonOutput.trim()}`);
        }

        if (code !== 0) {
            // Attempt to parse error message from Python's stdout
            let errorMessage = 'خطای ناشناخته در سرویس تبدیل متن به صدا.';
            try {
                const parsedOutput = JSON.parse(pythonOutput);
                errorMessage = parsedOutput.error || errorMessage;
            } catch (e) {
                // If stdout is not valid JSON, use stderr or a generic message
                errorMessage = pythonError || 'خطا در اجرای سرویس تبدیل متن به صدا.';
            }
            return res.status(500).json({ error: errorMessage });
        }

        try {
            const result = JSON.parse(pythonOutput);
            if (result.success && result.audio_file_path) {
                // Note: result.audio_file_path is now just the filename (e.g., "output_xxxx.wav")
                // because tts_worker.py puts the final file in the root directory.
                const audioFilePath = path.join(__dirname, result.audio_file_path);
                console.log(`[${sessionId}] ✅ فایل صوتی تولید شده: ${audioFilePath}`);

                // ارسال فایل صوتی به کلاینت
                res.sendFile(audioFilePath, (err) => {
                    if (err) {
                        console.error(`[${sessionId}] ❌ خطا در ارسال فایل صوتی:`, err);
                        return res.status(500).send('خطا در ارسال فایل صوتی.');
                    }
                    // پس از ارسال فایل، آن را پاک کنید
                    fs.unlink(audioFilePath, (unlinkErr) => {
                        if (unlinkErr) console.error(`[${sessionId}] 🧹 خطا در پاک کردن فایل موقت:`, unlinkErr);
                        else console.log(`[${sessionId}] 🧹 فایل موقت پاک شد: ${audioFilePath}`);
                    });
                });
            } else {
                const errMsg = result.error || 'فایل صوتی تولید نشد یا خطای ناشناخته رخ داد.';
                console.error(`[${sessionId}] ❌ پایتون موفقیت را برنگرداند:`, errMsg);
                res.status(500).json({ error: errMsg });
            }
        } catch (parseError) {
            console.error(`[${sessionId}] ❌ خطای JSON.parse در خروجی پایتون:`, parseError);
            console.error(`[${sessionId}] خروجی خام پایتون:`, pythonOutput);
            res.status(500).json({ error: 'خطا در پردازش پاسخ از سرویس تبدیل متن به صدا.' });
        }
    });

    pythonProcess.on('error', (err) => {
        console.error(`[${sessionId}] ❌ خطای اجرای فرآیند پایتون (spawn):`, err);
        res.status(500).json({ error: 'خطا در اجرای سرویس تبدیل متن به صدا.' });
    });
});

// Fallback برای هر مسیر دیگری - index.html شما را سرو می‌کند
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// شروع سرور
app.listen(PORT, () => {
    console.log(`سرور Node.js در پورت ${PORT} گوش می‌دهد.`);
    console.log(`دسترسی به برنامه شما در: http://localhost:${PORT} (یا URL Render.com شما)`);
});
