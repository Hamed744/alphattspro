const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid'); // برای تولید شناسه‌های منحصر به فرد

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware برای سرو کردن فایل‌های استاتیک از دایرکتوری 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Middleware برای پردازش بدنه درخواست‌های JSON
app.use(express.json());

// **جدید: مسیر مفسر پایتون در محیط مجازی**
// فرض می‌کنیم محیط مجازی 'venv' در ریشه پروژه شما ایجاد شده است.
// و مفسر پایتون در venv/bin/python3 قرار دارد.
const PYTHON_EXECUTABLE = path.join(__dirname, 'venv', 'bin', 'python3');

app.post('/generate-audio', (req, res) => {
    const { text, prompt, speaker, temperature } = req.body;

    if (!text || text.trim() === '') {
        return res.status(400).json({ error: 'متن ورودی نمی‌تواند خالی باشد.' });
    }

    const sessionId = uuidv4().substring(0, 8); // یک شناسه جلسه کوتاه برای لاگ‌ها

    console.log(`[${sessionId}] 🚀 درخواست جدید برای تولید صدا دریافت شد.`);
    console.log(`[${sessionId}] متن: "${text.substring(0, 50)}..."`);
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

    // **تغییر: استفاده از مسیر دقیق مفسر پایتون در محیط مجازی**
    const pythonProcess = spawn(PYTHON_EXECUTABLE, [pythonScriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
    });

    // ... بقیه کدهای server.js شما (همانند قبل) ...
    pythonProcess.stdin.write(JSON.stringify(inputData));
    pythonProcess.stdin.end();

    pythonProcess.stdout.on('data', (data) => {
        pythonOutput += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
        pythonError += data.toString();
        console.error(`[${sessionId}] خطای Python stderr: ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`[${sessionId}] اسکریپت پایتون با کد خروج ${code} بسته شد.`);

        if (code !== 0) {
            console.error(`[${sessionId}] خطای اسکریپت پایتون:`, pythonError);
            try {
                const errorParsed = JSON.parse(pythonOutput);
                return res.status(500).json({ error: errorParsed.error || 'خطای ناشناخته در سرویس تبدیل متن به صدا.' });
            } catch (parseError) {
                return res.status(500).json({ error: 'خطا در سرویس تبدیل متن به صدا: ' + (pythonError || 'پاسخ نامشخص.') });
            }
        }

        try {
            const result = JSON.parse(pythonOutput);
            if (result.success && result.audio_file_path) {
                const audioFilePath = path.join(__dirname, result.audio_file_path);
                console.log(`[${sessionId}] ✅ فایل صوتی تولید شده: ${audioFilePath}`);

                res.sendFile(audioFilePath, (err) => {
                    if (err) {
                        console.error(`[${sessionId}] ❌ خطا در ارسال فایل صوتی:`, err);
                        res.status(500).send('خطا در ارسال فایل صوتی.');
                    }
                    fs.unlink(audioFilePath, (unlinkErr) => {
                        if (unlinkErr) console.error(`[${sessionId}] 🧹 خطا در پاک کردن فایل موقت:`, unlinkErr);
                        else console.log(`[${sessionId}] 🧹 فایل موقت پاک شد: ${audioFilePath}`);
                    });
                });
            } else {
                console.error(`[${sessionId}] ❌ پایتون موفقیت را برنگرداند:`, result.error || 'پاسخ نامشخص');
                res.status(500).json({ error: result.error || 'فایل صوتی تولید نشد یا خطای ناشناخته رخ داد.' });
            }
        } catch (parseError) {
            console.error(`[${sessionId}] ❌ خطای JSON.parse در خروجی پایتون:`, parseError);
            console.error(`[${sessionId}] خروجی خام پایتون:`, pythonOutput);
            res.status(500).json({ error: 'خطا در پردازش پاسخ از سرویس تبدیل متن به صدا.' });
        }
    });

    pythonProcess.on('error', (err) => {
        console.error(`[${sessionId}] ❌ خطای اجرای فرآیند پایتون:`, err);
        res.status(500).json({ error: 'خطا در اجرای سرویس تبدیل متن به صدا.' });
    });
});

// Fallback برای هر مسیر دیگری - index.html شما را سرو می‌کند
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// شروع سرور
app.listen(PORT, () => {
    console.log(`سرور پروکسی Node.js در پورت ${PORT} گوش می‌دهد.`);
    console.log(`دسترسی به برنامه شما در: http://localhost:${PORT} (یا URL Render.com شما)`);
});
