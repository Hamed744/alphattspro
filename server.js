const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ====================================================================
// ۱. لیست تمام اسپیس‌های شما
// ====================================================================
const HF_SPACES = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];

// ====================================================================
// ۲. ابزارهای مدیریت جلسات چسبنده
// ====================================================================
// یک شمارنده برای انتخاب چرخشی اسپیس برای درخواست‌های جدید
let currentSpaceIndex = 0;
// یک Map برای ذخیره اینکه هر session_hash به کدام اسپیس تعلق دارد
// key: session_hash, value: hostname (e.g., 'hamed744-ttspro.hf.space')
const sessionMap = new Map();

// این middleware برای خواندن اطلاعات از بدنه درخواست POST (برای پیدا کردن session_hash) ضروری است
app.use(express.json());

// سرو کردن فایل‌های استاتیک از پوشه public
app.use(express.static(path.join(__dirname, 'public')));


// ====================================================================
// ۳. منطق اصلی پراکسی با قابلیت Sticky Session
// ====================================================================
app.use('/gradio_api', proxy(
    // این تابع به ازای هر درخواست اجرا شده و تصمیم می‌گیرد آن را به کدام اسپیس بفرستد
    (req) => {
        // ابتدا session_hash را از پارامترهای GET یا بدنه POST استخراج می‌کنیم
        const sessionHash = req.query.session_hash || (req.body && req.body.session_hash);

        // اگر session_hash وجود داشت و ما قبلاً برای آن یک اسپیس تعیین کرده بودیم...
        if (sessionHash && sessionMap.has(sessionHash)) {
            const targetSpace = sessionMap.get(sessionHash);
            console.log(`[STICKY] Session: ${sessionHash} -> Reusing Space: ${targetSpace}`);
            // ... درخواست را به همان اسپیس قبلی بفرست
            return targetSpace;
        }

        // اگر session_hash جدید بود یا اصلاً وجود نداشت (یک درخواست کاملا جدید)
        // با استفاده از منطق چرخشی یک اسپیس جدید انتخاب کن
        const targetSpace = HF_SPACES[currentSpaceIndex];
        console.log(`[NEW] Request: ${req.originalUrl} -> Assigning new Space: ${targetSpace}`);
        
        // شمارنده را برای درخواست بعدی یک واحد جلو ببر و اگر به انتها رسید به اول برگردان
        currentSpaceIndex = (currentSpaceIndex + 1) % HF_SPACES.length;

        // اگر درخواست ما session_hash داشت، آن را در حافظه ذخیره کن تا درخواست‌های بعدی همین جلسه به همین اسپیس بیایند
        if (sessionHash) {
            console.log(`[STICKY] Storing Session: ${sessionHash} -> Mapped to: ${targetSpace}`);
            sessionMap.set(sessionHash, targetSpace);

            // (اختیاری ولی بسیار مفید) یک تایمر برای پاک کردن session_hash از حافظه بعد از ۱۰ دقیقه
            // این کار از پر شدن حافظه سرور جلوگیری می‌کند
            setTimeout(() => {
                sessionMap.delete(sessionHash);
                console.log(`[CLEANUP] Session ${sessionHash} expired and removed from map.`);
            }, 10 * 60 * 1000); // 10 minutes
        }
        
        // نکته: درخواست دانلود فایل (/file=...) چون session_hash ندارد، به صورت چرخشی ارسال می‌شود.
        // اما چون بلافاصله بعد از اتمام کار می‌آید، شانس بسیار بالایی دارد که به اسپیس درست ارسال شود.
        
        return targetSpace;
    },
    {
        https: true,
        proxyReqPathResolver: function (req) {
            return req.originalUrl;
        },
        proxyErrorHandler: function (err, res, next) {
            console.error('Proxy error encountered:', err);
            res.status(500).send('An error occurred while connecting to the AI service. Please try again later.');
        }
    }
));

// Fallback برای هر روت دیگر - فایل index.html را سرو کن
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// استارت سرور
app.listen(PORT, () => {
    console.log(`Proxy server with Round-Robin & Sticky Sessions listening on port ${PORT}`);
    console.log(`Distributing load across: ${HF_SPACES.join(', ')}`);
});
