// server.js
// این کد نهایی با منطق "Sticky Sessions" برای حل مشکل شماست.

const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// برای خواندن JSON از بدنه درخواست (برای گرفتن session_hash)
app.use(express.json());

// لیست آدرس‌های Hugging Face Space شما
const HF_TARGETS = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];

// این متغیر، شماره اسپیسی که باید درخواست بعدی را دریافت کند، نگه می‌دارد.
let nextTargetIndex = 0;

// **بخش کلیدی جدید:**
// یک Map برای نگهداری اینکه کدام session_hash به کدام اسپیس متصل شده است.
// { 'session_hash_123': 'hamed744-ttspro.hf.space', 'session_hash_456': 'hamed744-ttspro2.hf.space' }
const sessionToTargetMap = new Map();

// این بخش فایل‌های استاتیک مثل index.html را سرو می‌کند.
app.use(express.static(path.join(__dirname, 'public')));


// این بخش مهم، تمام درخواست‌های API را مدیریت می‌کند.
app.use('/gradio_api', (req, res, next) => {
    let target;
    // session_hash را از درخواست استخراج می‌کنیم.
    // می‌تواند در body (برای join) یا در query (برای data/file) باشد.
    const sessionHash = req.body.session_hash || req.query.session_hash;

    if (sessionHash && sessionToTargetMap.has(sessionHash)) {
        // اگر این session قبلاً به یک اسپیس اختصاص داده شده، از همان استفاده کن.
        target = sessionToTargetMap.get(sessionHash);
        console.log(`[Sticky Session] Found existing session ${sessionHash}. Routing to: ${target}`);
    } else {
        // اگر این یک session جدید است، یک اسپیس به آن اختصاص بده.
        target = HF_TARGETS[nextTargetIndex];
        nextTargetIndex = (nextTargetIndex + 1) % HF_TARGETS.length;
        
        if (sessionHash) {
            // اسپیس انتخاب شده را برای این session به خاطر بسپار.
            sessionToTargetMap.set(sessionHash, target);
            console.log(`[New Session] Assigning session ${sessionHash} to: ${target}`);
            
            // برای جلوگیری از پر شدن حافظه، این session را بعد از 10 دقیقه پاک می‌کنیم.
            setTimeout(() => {
                sessionToTargetMap.delete(sessionHash);
                console.log(`[Cleanup] Session ${sessionHash} expired and was removed.`);
            }, 10 * 60 * 1000); // 10 دقیقه
        } else {
             console.log(`[Warning] Request without session_hash. Using round-robin target: ${target}`);
        }
    }

    // حالا که هدف (target) مشخص شد، پروکسی را با آن هدف اجرا می‌کنیم.
    proxy(target, {
        https: true,
        proxyReqPathResolver: (proxyReq) => proxyReq.originalUrl,
        proxyErrorHandler: (err, proxyRes, next) => {
            console.error(`[Proxy Error] Could not connect to ${target}. Error: ${err.message}`);
            // اگر خطایی رخ داد، session را از map پاک می‌کنیم تا دفعه بعد دوباره تلاش شود.
            if (sessionHash) {
                sessionToTargetMap.delete(sessionHash);
            }
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
    console.log(`Total Spaces in rotation: ${HF_TARGETS.length}`);
});
