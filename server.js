// server.js
// این کد نهایی با منطق Sticky Sessions برای حل مشکل پخش نشدن صدا است.

const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// لیست آدرس‌های Hugging Face Space شما
const HF_TARGETS = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];

// یک تابع ساده برای تولید یک "هش" از یک رشته.
// این به ما کمک می‌کند تا یک session_hash همیشه به یک اسپیس یکسان نگاشت شود.
function simpleHashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // تبدیل به عدد صحیح ۳۲ بیتی
    }
    return Math.abs(hash);
}

// این بخش فایل‌های استاتیک مثل index.html را سرو می‌کند.
app.use(express.static(path.join(__dirname, 'public')));

// این بخش مهم، تمام درخواست‌های API را هوشمندانه مدیریت می‌کند.
app.use('/gradio_api', (req, res, next) => {
    let targetIndex;

    // تلاش می‌کنیم session_hash را از URL استخراج کنیم.
    // URL ممکن است به این شکل باشد: /gradio_api/queue/data?session_hash=abcdef123
    const parsedUrl = url.parse(req.originalUrl, true);
    const sessionHash = parsedUrl.query.session_hash;

    if (sessionHash) {
        // اگر session_hash وجود داشت، از آن برای انتخاب یک اسپیس ثابت استفاده می‌کنیم.
        // این تضمین می‌کند که تمام درخواست‌های یک جلسه (ساخت، دریافت داده، دریافت فایل) به یک اسپیس بروند.
        targetIndex = simpleHashCode(sessionHash) % HF_TARGETS.length;
        console.log(`[Sticky Session] Routing based on session_hash '${sessionHash}' to target index: ${targetIndex}`);
    } else {
        // اگر session_hash وجود نداشت (معمولاً برای اولین درخواست queue/join)،
        // از یک روش چرخشی ساده استفاده می‌کنیم.
        // Gradio در پاسخ به این درخواست، session_hash را ایجاد می‌کند.
        targetIndex = Math.floor(Math.random() * HF_TARGETS.length);
        console.log(`[New Session] Routing randomly to target index: ${targetIndex}`);
    }

    const target = HF_TARGETS[targetIndex];
    console.log(`Forwarding request to: ${target}`);

    // حالا که هدف مشخص شد، پروکسی را با آن هدف اجرا می‌کنیم.
    proxy(target, {
        https: true,
        proxyReqPathResolver: (proxyReq) => proxyReq.originalUrl,
        proxyErrorHandler: (err, proxyRes, next) => {
            console.error(`[Proxy Error] Could not connect to ${target}. Error: ${err.message}`);
            proxyRes.status(503).send('The AI service is temporarily unavailable. Please try again.');
        }
    })(req, res, next);
});

// این بخش اطمینان می‌دهد که همه مسیرهای دیگر به صفحه اصلی شما هدایت می‌شوند.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// سرور را اجرا می‌کند
app.listen(PORT, () => {
    console.log(`🚀 Alpha TTS server with STICKY SESSIONS is running on port ${PORT}`);
    console.log(`Total Spaces configured: ${HF_TARGETS.length}`);
});
