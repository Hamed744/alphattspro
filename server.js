// server.js
// این کد نهایی و قطعی برای حل مشکل پخش فایل با چند اسپیس است.
// این کد، آدرس اسپیس تولیدکننده را در نام فایل جاسازی می‌کند و سپس آن را مسیریابی می‌کند.

const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// برای خواندن JSON از بدنه درخواست (برای درخواست‌های POST از Gradio)
app.use(express.json());

// لیست آدرس‌های Hugging Face Space شما
const HF_TARGETS = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];

// این متغیر، شماره اسپیسی که باید درخواست‌های جدید را دریافت کند، نگه می‌دارد.
let nextTargetIndex = 0;

// یک Map برای نگهداری اینکه کدام session_hash به کدام اسپیس متصل شده است.
// این برای اطمینان از اینکه join و data به یک اسپیس می‌روند، ضروری است.
const sessionToTargetMap = new Map();


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
            const originalFilePath = parts.slice(1).join('/');
            
            // بازنویسی req.url برای ارسال به پروکسی (فقط نام فایل را نگه می‌داریم)
            req.url = `/gradio_api/file=${originalFilePath}`;
            console.log(`[File Proxy] Routing file request for "${originalFilePath}" to specific space: ${target}`);
        }
    }
    
    // 2. استخراج هدف از session_hash برای درخواست‌های data
    const sessionHash = req.body.session_hash || req.query.session_hash;
    if (!target && sessionHash && sessionToTargetMap.has(sessionHash)) {
        target = sessionToTargetMap.get(sessionHash);
        console.log(`[Sticky Session] Routing data request for session ${sessionHash} to: ${target}`);
    }

    // 3. اگر هدف هنوز مشخص نشده (یعنی یک درخواست جدید join است)، از Round-Robin استفاده کن
    if (!target) {
        target = HF_TARGETS[nextTargetIndex];
        nextTargetIndex = (nextTargetIndex + 1) % HF_TARGETS.length;
        console.log(`[Load Balancer] New request. Assigning to: ${target}`);
        
        // اگر درخواست جدید session_hash دارد، آن را در map ذخیره کن
        if (sessionHash) {
            sessionToTargetMap.set(sessionHash, target);
            console.log(`[Sticky Session] Registered session ${sessionHash} with target ${target}`);
            // پاک کردن session از حافظه بعد از 10 دقیقه برای جلوگیری از پر شدن
            setTimeout(() => {
                sessionToTargetMap.delete(sessionHash);
                console.log(`[Cleanup] Session ${sessionHash} expired and was removed.`);
            }, 10 * 60 * 1000);
        }
    }

    // اگر به هر دلیلی هدف تعیین نشده بود، یک هدف پیش‌فرض انتخاب کن
    if (!target) {
        target = HF_TARGETS[0];
        console.warn('[Fallback] Target could not be determined. Using default:', target);
    }

    // حالا که هدف (target) مشخص شد، پروکسی را با آن هدف اجرا می‌کنیم.
    proxy(target, {
        https: true,
        proxyReqPathResolver: (proxyReq) => {
            // از req.url که ممکن است بازنویسی شده باشد استفاده می‌کنیم
            return proxyReq.url;
        },
        
        // **اینجا جادوی اصلی برای اصلاح URL فایل اتفاق می‌افتد:**
        responseBodyDecorator: async function (bodyBuffer, proxyRes) {
            // فقط برای درخواست‌های data این کار را انجام بده
            if (!proxyRes.req.originalUrl.includes('/queue/data')) {
                return bodyBuffer;
            }

            let body = bodyBuffer.toString('utf8');
            let modifiedBody = '';

            const lines = body.split('\n');
            for (const line of lines) {
                if (line.startsWith('data:')) {
                    try {
                        const jsonData = JSON.parse(line.substring(5));
                        if (jsonData.msg === 'process_completed' && jsonData.success && jsonData.output?.data?.[0]?.name) {
                            const originalFilename = jsonData.output.data[0].name;
                            // نام فایل را با افزودن آدرس اسپیس به اول آن تغییر می‌دهیم.
                            jsonData.output.data[0].name = `${target}/${originalFilename}`;
                            console.log(`[Proxy Intercept] Injected space host into filename: ${jsonData.output.data[0].name}`);
                        }
                        modifiedBody += `data:${JSON.stringify(jsonData)}\n`;
                    } catch (e) {
                        modifiedBody += line + '\n';
                    }
                } else {
                    modifiedBody += line + '\n';
                }
            }
            return Buffer.from(modifiedBody, 'utf8');
        },

        proxyErrorHandler: function (err, res, next) {
            console.error(`[Proxy Error] Could not connect to ${target}. Error: ${err.message}`);
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
    console.log(`🚀 Alpha TTS server with Advanced File Routing is running on port ${PORT}`);
    console.log(`Total Spaces in rotation: ${HF_TARGETS.length}`);
});
