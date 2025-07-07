// server.js
// این فایل پروژه‌ی رندر شماست که به عنوان پروکسی عمل می‌کند.

const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // Render will provide a PORT, otherwise use 3000

// --- تنها بخشی که تغییر کرده: لیست آدرس‌های Hugging Face Space ---
// لیستی از آدرس کامل اسپیس‌های هاگینگ فیس شما
// اطمینان حاصل کنید که این آدرس‌ها دقیقاً همان‌هایی هستند که شما ساخته‌اید.
const HF_TARGETS = [
    'hamed744-ttspro.hf.space',   // اسپیس اول
    'hamed744-ttspro2.hf.space',  // اسپیس دوم
    'hamed744-ttspro3.hf.space'   // اسپیس سوم
];

// متغیری برای نگهداری ایندکس اسپیس فعلی (برای Round-Robin)
let currentTargetIndex = 0;
// --- پایان بخش تغییر یافته ---


// Serve static files from the 'public' directory
// این خط مسئول سرو کردن فایل‌های HTML, CSS, JS از پوشه 'public' است.
app.use(express.static(path.join(__dirname, 'public')));

// Proxy all requests starting with /gradio_api to Hugging Face Space
// این بخش درخواست‌های API را از مرورگر کاربر می‌گیرد و به اسپیس‌های هاگینگ فیس ارسال می‌کند.
app.use('/gradio_api', (req, res, next) => {
    // 1. انتخاب اسپیس بعدی به صورت چرخشی (Round-Robin)
    const target = HF_TARGETS[currentTargetIndex];
    currentTargetIndex = (currentTargetIndex + 1) % HF_TARGETS.length; // به ایندکس بعدی برو، اگر به آخر رسیدی برگرد به اول

    console.log(`[Proxy] Forwarding request to Hugging Face Space: ${target} (Next target index: ${currentTargetIndex})`); // برای لاگ و دیباگ

    // 2. اجرای پروکسی با هدف (target) انتخاب شده
    proxy(target, {
        https: true, // بسیار مهم: برای اتصال امن به Hugging Face از HTTPS استفاده شود
        proxyReqPathResolver: function (req) {
            // این تابع مسیر درخواست اصلی را حفظ می‌کند تا به درستی به Gradio ارسال شود.
            // مثلاً /gradio_api/queue/data?session_hash=xyz به /gradio_api/queue/data?session_hash=xyz تبدیل می‌شود.
            return req.originalUrl;
        },
        // مدیریت خطا در صورتی که پروکسی نتواند به اسپیس هاگینگ فیس متصل شود
        proxyErrorHandler: function (err, proxyRes, next) {
            console.error('[Proxy Error] Failed to connect to Hugging Face Space:', err.message);
            // می‌توانید در اینجا منطق پیشرفته‌تری برای تلاش مجدد یا اعلام به کاربر پیاده‌سازی کنید.
            res.status(500).send('An error occurred while connecting to the AI service. Please try again later.');
        }
    })(req, res, next); // مهم: ()req, res, next باید بعد از تابع proxy فراخوانی شود
});

// Fallback for any other route - serve your index.html
// این اطمینان می‌دهد که اگر کاربر مستقیماً به آدرس اصلی رندر شما رفت، صفحه index.html را ببیند.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Proxy server with Load Balancing for Hugging Face Spaces listening on port ${PORT}`);
    console.log(`Access your application at: http://localhost:${PORT} (or your Render.com URL)`);
    console.log(`Currently configured Hugging Face Spaces: ${HF_TARGETS.join(', ')}`);
});
