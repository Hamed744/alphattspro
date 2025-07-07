// server.js
// این کد نهایی و قطعی با استفاده از هدر Referer برای مسیریابی صحیح است.

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
    let target;
    
    // --- منطق جدید و کلیدی ---
    // آیا درخواست برای دریافت یک فایل است؟ (مسیر شامل /file= می‌شود)
    const isFileRequest = req.originalUrl.includes('/file=');
    const refererHeader = req.headers.referer;

    if (isFileRequest && refererHeader) {
        // اگر درخواست برای فایل است و هدر Referer وجود دارد،
        // سعی می‌کنیم اسپیس اصلی را از آن استخراج کنیم.
        const refererUrl = new URL(refererHeader);
        const sourceHost = refererUrl.searchParams.get('__hf_space_host'); // هاگینگ فیس این پارامتر را اضافه می‌کند
        
        if (sourceHost && HF_TARGETS.includes(sourceHost)) {
            target = sourceHost;
            console.log(`[File Request Routing] Referer found. Routing to original space: ${target}`);
        }
    }
    
    if (!target) {
        // اگر نتوانستیم هدف را از Referer پیدا کنیم (مثلاً برای اولین درخواست)،
        // از روش چرخشی برای انتخاب یک اسپیس استفاده می‌کنیم.
        target = HF_TARGETS[nextTargetIndex];
        nextTargetIndex = (nextTargetIndex + 1) % HF_TARGETS.length;
        console.log(`[Round Robin] No specific route. Assigning new request to: ${target}`);
    }

    // حالا که هدف (target) مشخص شد، پروکسی را با آن هدف اجرا می‌کنیم.
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
    console.log(`🚀 Alpha TTS server with Intelligent Routing is running on port ${PORT}`);
    console.log(`Total Spaces in rotation: ${HF_TARGETS.length}`);
});
