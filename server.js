// server.js
// این کد نهایی و قطعی برای حل مشکل پخش فایل است.
// این کد، آدرس اسپیس تولیدکننده را در نام فایل جاسازی می‌کند.

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

    // 1. استخراج آدرس اسپیس از پارامتر 'file=' اگر درخواست از نوع فایل باشد
    const fileParam = req.query.file;
    if (fileParam) {
        // فایل پارامتر به شکل "hamed744-ttspro2.hf.space/output_xyz.wav" خواهد بود.
        const decodedFileParam = decodeURIComponent(fileParam);
        const parts = decodedFileParam.split('/');
        
        // اگر حداقل دو بخش (هاست/فایل) وجود دارد و هاست در لیست ماست
        if (parts.length >= 2 && HF_TARGETS.includes(parts[0])) {
            target = parts[0]; // اسپیس اصلی را استخراج می‌کنیم
            // بازنویسی req.url برای ارسال به پروکسی (فقط نام فایل را نگه می‌داریم)
            req.url = req.originalUrl.replace(fileParam, parts.slice(1).join('/'));
            console.log(`[File Proxy] Routing file request for "${parts[1]}" to specific space: ${target}`);
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
        https: true,
        proxyReqPathResolver: (proxyReq) => proxyReq.originalUrl,
        
        // **اینجا جادوی اصلی برای اصلاح URL فایل اتفاق می‌افتد:**
        // این تابع به ما اجازه می‌دهد پاسخ Gradio را قبل از ارسال به مرورگر تغییر دهیم.
        responseBodyDecorator: function (bodyBuffer, proxyRes) {
            // بدنه پاسخ SSE stream است، که شامل چندین خط "data: {...}" می‌شود.
            // باید خط به خط پردازش کنیم.
            let body = bodyBuffer.toString('utf8');
            let modifiedBody = '';

            // خطوط را جدا می‌کنیم و هر خط را بررسی می‌کنیم.
            const lines = body.split('\n');
            for (const line of lines) {
                if (line.startsWith('data:')) {
                    try {
                        const jsonData = JSON.parse(line.substring(5)); // حذف 'data:'
                        // اگر پیام process_completed باشد و حاوی نام فایل باشد
                        if (jsonData.msg === 'process_completed' && jsonData.success && jsonData.output?.data?.[0]?.name) {
                            // نام فایل اصلی را با افزودن آدرس اسپیس به اول آن تغییر می‌دهیم.
                            // مثال: "output_xyz.wav" تبدیل می‌شود به "hamed744-ttsproX.hf.space/output_xyz.wav"
                            jsonData.output.data[0].name = `${proxyRes.req.originalHost || target}/${jsonData.output.data[0].name}`;
                            console.log(`[Proxy Intercept] Injected space host into filename: ${jsonData.output.data[0].name}`);
                        }
                        modifiedBody += `data:${JSON.stringify(jsonData)}\n`;
                    } catch (e) {
                        // اگر خط JSON قابل پارس نباشد، آن را دست‌نخورده می‌فرستیم.
                        console.warn(`[Proxy Intercept] Failed to parse JSON from SSE line: ${line}`, e);
                        modifiedBody += line + '\n';
                    }
                } else {
                    modifiedBody += line + '\n';
                }
            }
            return Buffer.from(modifiedBody, 'utf8'); // بدنه تغییر یافته را برمی‌گردانیم
        },

        proxyErrorHandler: function (err, proxyRes, next) {
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
    console.log(`🚀 Alpha TTS server with Advanced File Routing is running on port ${PORT}`);
    console.log(`Total Spaces in rotation: ${HF_TARGETS.length}`);
});
