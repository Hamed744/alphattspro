const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// **جدید: مسیر مفسر پایتون در محیط مجازی را به صورت هوشمند پیدا کنید**
let PYTHON_EXECUTABLE;
const venvBinPath = path.join(__dirname, 'venv', 'bin');

// اولویت با python3 در venv/bin
if (fs.existsSync(path.join(venvBinPath, 'python3'))) {
    PYTHON_EXECUTABLE = path.join(venvBinPath, 'python3');
}
// اگر python3 نبود، python را در venv/bin چک کن
else if (fs.existsSync(path.join(venvBinPath, 'python'))) {
    PYTHON_EXECUTABLE = path.join(venvBinPath, 'python');
}
// در نهایت، اگر venv/bin/python3 یا venv/bin/python پیدا نشد، به سراغ python3 سیستمی برو.
// این یک fallback است که در صورت عدم موفقیت venv به کار می‌رود.
else {
    console.warn("Python executable not found in venv. Falling back to system-wide 'python3'. Ensure venv is created correctly.");
    PYTHON_EXECUTABLE = 'python3'; 
}

console.log(`[Node.js] Using Python executable: ${PYTHON_EXECUTABLE}`);


app.post('/generate-audio', (req, res) => {
    const { text, prompt, speaker, temperature } = req.body;

    if (!text || text.trim() === '') {
        return res.status(400).json({ error: 'متن ورودی نمی‌تواند خالی باشد.' });
    }

    const sessionId = uuidv4().substring(0, 8);

    console.log(`[${sessionId}] 🚀 New request received for audio generation.`);
    console.log(`[${sessionId}] Text: "${text.substring(0, Math.min(text.length, 50))}..."`);
    console.log(`[${sessionId}] Speaker: ${speaker}, Temperature: ${temperature}`);

    const pythonScriptPath = path.join(__dirname, 'tts_worker.py');

    // **مهم: مطمئن شو که فایل اسکریپت وجود دارد**
    if (!fs.existsSync(pythonScriptPath)) {
        console.error(`[${sessionId}] ❌ Error: Python script not found at ${pythonScriptPath}`);
        return res.status(500).json({ error: 'خطای داخلی سرور: اسکریپت TTS پیدا نشد.' });
    }
    // **مهم: مطمئن شو که مفسر پایتون وجود دارد (اگر یک مسیر مطلق است)**
    if (PYTHON_EXECUTABLE.startsWith('/') || PYTHON_EXECUTABLE.startsWith('./')) { // Check if it's an absolute or relative path
        if (!fs.existsSync(PYTHON_EXECUTABLE)) {
            console.error(`[${sessionId}] ❌ Error: Python executable not found at ${PYTHON_EXECUTABLE}`);
            return res.status(500).json({ error: 'خطای داخلی سرور: مفسر پایتون پیدا نشد.' });
        }
    }


    const inputData = {
        text: text,
        prompt: prompt,
        speaker: speaker,
        temperature: parseFloat(temperature), // Ensure temperature is a number
        session_id: sessionId
    };

    let pythonOutput = '';
    let pythonError = '';

    const pythonProcess = spawn(PYTHON_EXECUTABLE, [pythonScriptPath], {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    pythonProcess.stdin.write(JSON.stringify(inputData));
    pythonProcess.stdin.end();

    pythonProcess.stdout.on('data', (data) => {
        pythonOutput += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
        pythonError += data.toString();
        console.error(`[${sessionId}] Python stderr: ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`[${sessionId}] Python script exited with code ${code}.`);

        if (code !== 0) {
            console.error(`[${sessionId}] Python script failed. Full stderr:`, pythonError);
            console.error(`[${sessionId}] Python script stdout (potential JSON error):`, pythonOutput);
            try {
                const errorParsed = JSON.parse(pythonOutput);
                return res.status(500).json({ error: errorParsed.error || 'خطای ناشناخته از سرویس پایتون.' });
            } catch (parseError) {
                return res.status(500).json({ error: 'خطا در سرویس تبدیل متن به صدا. لطفاً لاگ‌های سرور را بررسی کنید. پیام خطای پایتون: ' + (pythonError || 'پاسخ نامشخص.') });
            }
        }

        try {
            const result = JSON.parse(pythonOutput);
            if (result.success && result.audio_file_path) {
                const audioFilePath = path.join(__dirname, result.audio_file_path);
                console.log(`[${sessionId}] ✅ Audio file generated: ${audioFilePath}`);

                res.sendFile(audioFilePath, (err) => {
                    if (err) {
                        console.error(`[${sessionId}] ❌ Error sending audio file:`, err);
                        res.status(500).send('خطا در ارسال فایل صوتی.');
                    }
                    fs.unlink(audioFilePath, (unlinkErr) => {
                        if (unlinkErr) console.error(`[${sessionId}] 🧹 Error cleaning up temporary file:`, unlinkErr);
                        else console.log(`[${sessionId}] 🧹 Temporary file deleted: ${audioFilePath}`);
                    });
                });
            } else {
                console.error(`[${sessionId}] ❌ Python script did not return success or audio file path:`, result.error || 'Unknown response');
                res.status(500).json({ error: result.error || 'فایل صوتی تولید نشد یا خطای ناشناخته رخ داد.' });
            }
        } catch (parseError) {
            console.error(`[${sessionId}] ❌ JSON.parse error from Python stdout:`, parseError);
            console.error(`[${sessionId}] Raw Python stdout:`, pythonOutput);
            res.status(500).json({ error: 'خطا در پردازش پاسخ از سرویس تبدیل متن به صدا (پاسخ پایتون نامعتبر است).' });
        }
    });

    pythonProcess.on('error', (err) => {
        console.error(`[${sessionId}] ❌ Failed to start Python process:`, err);
        // This 'error' event usually fires if the executable specified in spawn is not found
        if (err.code === 'ENOENT') {
            res.status(500).json({ error: `خطا در اجرای سرویس پایتون: مفسر پایتون در مسیر '${PYTHON_EXECUTABLE}' پیدا نشد.` });
        } else {
            res.status(500).json({ error: `خطای ناشناخته در اجرای سرویس پایتون: ${err.message}` });
        }
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Node.js server listening on port ${PORT}`);
    console.log(`Access your application at: http://localhost:${PORT} (or your Render.com URL)`);
});
