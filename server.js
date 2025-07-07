const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. لیستی از تمام اسپیس‌های هدف خود را اینجا وارد کنید
const HF_TARGETS = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];

let currentTargetIndex = 0;
const sessionMap = {}; // این آبجکت برای نگهداری session و اسپیس مربوطه است

// میدل‌ور برای خواندن body درخواست‌های POST (برای گرفتن session_hash)
app.use(express.json());

// سرو کردن فایل‌های استاتیک از پوشه 'public'
app.use(express.static(path.join(__dirname, 'public')));

// 2. پراکسی هوشمند با منطق چرخشی و Sticky Session
app.use('/gradio_api', proxy(
    (req) => {
        // از body (برای /join) یا query (برای /data و /file) مقدار session_hash را بخوان
        const sessionHash = req.body.session_hash || req.query.session_hash;

        if (sessionHash) {
            // اگر این session قبلا ثبت نشده، یک اسپیس جدید به آن اختصاص بده
            if (!sessionMap[sessionHash]) {
                const targetHost = HF_TARGETS[currentTargetIndex];
                sessionMap[sessionHash] = targetHost;
                
                console.log(`[ASSIGN] New session ${sessionHash} -> ${targetHost}`);

                // ایندکس را برای درخواست بعدی یک واحد جلو ببر (و به اول لیست برگرد اگر به آخر رسید)
                currentTargetIndex = (currentTargetIndex + 1) % HF_TARGETS.length;

                // برای جلوگیری از پر شدن حافظه، session را بعد از 5 دقیقه پاک کن
                setTimeout(() => {
                    delete sessionMap[sessionHash];
                    console.log(`[CLEANUP] Session ${sessionHash} expired.`);
                }, 300000); // 5 دقیقه
            }
            // اسپیس اختصاص داده شده به این session را برگردان
            return sessionMap[sessionHash];
        }

        // اگر درخواستی session_hash نداشت (که نباید اتفاق بیفتد)، به عنوان آخرین راه حل به صورت چرخشی عمل کن
        console.warn(`[WARN] Request without session_hash: ${req.path}. Using default round-robin.`);
        const fallbackHost = HF_TARGETS[currentTargetIndex];
        currentTargetIndex = (currentTargetIndex + 1) % HF_TARGETS.length;
        return fallbackHost;
    },
    {
        https: true, // اتصال امن به Hugging Face
        proxyReqPathResolver: function (req) {
            return req.originalUrl;
        },
        proxyErrorHandler: function (err, res, next) {
            console.error('Proxy error encountered:', err);
            // سعی کن session را از map حذف کنی تا درخواست بعدی دوباره تلاش کند
            const sessionHash = req.body.session_hash || req.query.session_hash;
            if (sessionHash) {
                delete sessionMap[sessionHash];
            }
            res.status(502).send('An error occurred while connecting to the AI service. Please try again later.');
        }
    }
));

// فال‌بک برای تمام روت‌های دیگر
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// اجرای سرور
app.listen(PORT, () => {
    console.log(`Proxy server listening on port ${PORT}`);
    console.log(`Distributing requests across: ${HF_TARGETS.join(', ')}`);
});
