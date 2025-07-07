// server.js
// این کد نهایی و قطعی برای حل مشکل پخش فایل است.
// این کد، آدرس اسپیس تولیدکننده را در نام فایل جاسازی می‌کند و سپس آن را مسیریابی می‌کند.

const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// لیست آدرس‌های Hugging Face Space شما
const HF_TARGETS = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];

// این متغیر، شماره اسپیسی که باید درخواست‌های جدید را دریافت کند، نگه می‌دارد.
let nextTargetIndex = 0;

// این بخش فایل‌های استاتیک مثل index.html را سرو می‌کند.
app.use(express.static(path.join(__dirname, 'public')));

// این بخش مهم، تمام درخواست‌های API را مدیریت می‌کند.
app.use('/gradio_api', (req, res, next) => {
    let target; // این متغیر، اسپیس نهایی را برای این درخواست نگه می‌دارد.

    // 1. بررسی می‌کنیم آیا این درخواست برای دریافت یک فایل صوتی نهایی است یا خیر.
    const fileParam = req.query.file; // پارامتر 'file' در URL (مثلاً /gradio_api/file=...)
    if (fileParam) {
        // اگر پارامتر 'file' وجود دارد، سعی می‌کنیم آدرس اسپیس را از آن استخراج کنیم.
        const decodedFileParam = decodeURIComponent(fileParam);
        const parts = decodedFileParam.split('/');
        
        // اگر آدرس اسپیس در ابتدای نام فایل جاسازی شده باشد (مثلاً hamed744-ttsproX.hf.space/output_xyz.wav)
        if (parts.length > 1 && HF_TARGETS.includes(parts[0])) {
            target = parts[0]; // اسپیس اصلی که فایل را تولید کرده است
            // مسیر URL درخواست را برای پروکسی اصلاح می‌کنیم (بخش آدرس اسپیس را حذف می‌کنیم)
            // به این ترتیب، پروکسی فقط نام فایل را به اسپیس می‌فرستد.
            req.url = req.originalUrl.replace(fileParam, parts.slice(1).join('/'));
            console.log(`[File Routing] Request for file "${parts.slice(1).join('/')}" routed to specific space: ${target}`);
        }
    }
    
    // 2. اگر هدف هنوز مشخص نشده (یعنی یک درخواست جدید join/data است)، از Round-Robin استفاده کن
    if (!target) {
        target = HF_TARGETS[nextTargetIndex];
        nextTargetIndex = (nextTargetIndex + 1) % HF_TARGETS.length;
        console.log(`[Load Balancer] New request. Assigning to: ${target}`);
    }

    // حالا که هدف (target) مشخص شد، پروکسی را با آن هدف اجرا می‌کنیم.
    proxy(target, {
        https: true, // همیشه برای اتصال به هاگینگ فیس از HTTPS استفاده کنید.
        proxyReqPathResolver: (proxyReq) => proxyReq.originalUrl,
        
        // **اینجا جادوی اصلی برای اصلاح URL فایل در پاسخ اتفاق می‌افتد:**
        // این تابع به ما اجازه می‌دهد بدنه پاسخ Gradio را (که یک SSE stream است)
        // قبل از ارسال به مرورگر تغییر دهیم.
        responseBodyDecorator: function (bodyBuffer, proxyRes) {
            let body = bodyBuffer.toString('utf8');
            let modifiedBody = '';

            // پاسخ Gradio یک stream از خطوط 'data: {...}' است.
            const lines = body.split('\n');
            for (const line of lines) {
                if (line.startsWith('data:')) {
                    try {
                        const jsonData = JSON.parse(line.substring(5)); // حذف 'data:' از ابتدای خط
                        
                        // اگر پیام 'process_completed' باشد و حاوی نام فایل باشد
                        if (jsonData.msg === 'process_completed' && jsonData.success && jsonData.output?.data?.[0]?.name) {
                            // **بسیار مهم:**
                            // نام فایل اصلی را با افزودن آدرس کامل اسپیس در ابتدای آن تغییر می‌دهیم.
                            // `target` در اینجا همان اسپیسی است که این پاسخ از آن دریافت شده است.
                            jsonData.output.data[0].name = `${target}/${jsonData.output.data[0].name}`;
                            console.log(`[Proxy Intercept] Modified filename to include space: ${jsonData.output.data[0].name}`);
                        }
                        modifiedBody += `data:${JSON.stringify(jsonData)}\n`; // خط اصلاح شده را اضافه می‌کنیم
                    } catch (e) {
                        // اگر خط JSON قابل پارس نباشد (مثلاً لاگ Gradio باشد)، آن را دست‌نخورده می‌فرستیم.
                        console.warn(`[Proxy Intercept] Failed to parse JSON from SSE line, passing through: ${line.substring(0, 50)}...`, e.message);
                        modifiedBody += line + '\n';
                    }
                } else {
                    modifiedBody += line + '\n'; // سایر خطوط (مثل پیام‌های keepalive)
                }
            }
            return Buffer.from(modifiedBody, 'utf8'); // بدنه تغییر یافته را برمی‌گردانیم
        },

        proxyErrorHandler: function (err, proxyRes, next) {
            console.error(`[Proxy Error] Failed to connect to ${target}. Error: ${err.message}`);
            res.status(503).send('The AI service is temporarily unavailable. Please try again.');
        }
    })(req, res, next);
});

// این بخش اطمینان می‌دهد که همه مسیرهای دیگر به صفحه اصلی شما هدایت می‌شوند.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// سرور را اجرا می‌کند
app.listen(PORT, () => {
    console.log(`🚀 Alpha TTS server with Robust File Routing is running on port ${PORT}`);
    console.log(`Total Hugging Face Spaces in rotation: ${HF_TARGETS.length}`);
});
