const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// لیست آدرس های اسپیس های شما
const HF_TARGETS = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];

// این متغیر، شمارنده مرکزی ما برای توزیع بار است
let currentTargetIndex = 0;

// تابعی برای انتخاب سرور بعدی به صورت چرخشی
const getNextTarget = () => {
    const target = HF_TARGETS[currentTargetIndex];
    // شمارنده را برای درخواست بعدی افزایش می دهیم
    currentTargetIndex = (currentTargetIndex + 1) % HF_TARGETS.length;
    return target;
};

// دیکشنری برای نگهداری اینکه هر session_hash به کدام سرور ارسال شده است
// این کلیدی ترین بخش برای حل مشکل است!
const sessionTargetMap = {};

// سرویس دهی فایل های استاتیک (index.html, css, js)
app.use(express.static(path.join(__dirname, 'public')));

// *** بخش اصلی تغییرات اینجاست ***
// پروکسی ما حالا به یک مسیر ثابت گوش می دهد، درست مثل کد اولیه شما
app.use('/gradio_api', proxy(
    (req) => {
        const sessionHash = req.query.session_hash;

        // اگر درخواست برای دانلود فایل صوتی است (که session_hash ندارد)
        // یا اگر درخواست برای دریافت داده (queue/data) است
        if (req.path.startsWith('/file=') || (req.path.startsWith('/queue/data') && sessionHash)) {
            // سروری که قبلا برای این session انتخاب شده را پیدا می کنیم
            const targetHost = sessionTargetMap[sessionHash];
            if (targetHost) {
                console.log(`SESSION ${sessionHash} -> Re-routing to EXISTING target: ${targetHost}`);
                return targetHost;
            }
        }

        // اگر یک درخواست جدید برای شروع کار (queue/join) است
        if (req.path.startsWith('/queue/join')) {
            // یک سرور جدید به صورت چرخشی انتخاب می کنیم
            const targetHost = getNextTarget();
            
            // در بدنه درخواست (body)، session_hash را پیدا کرده و در دیکشنری ذخیره می کنیم
            // express.json() برای خواندن body لازم است
            const newSessionHash = req.body.session_hash;
            if (newSessionHash) {
                sessionTargetMap[newSessionHash] = targetHost;
                console.log(`SESSION ${newSessionHash} -> Assigned NEW target: ${targetHost}`);
                
                // یک تایمر برای پاک کردن session از حافظه بعد از مدتی (مثلا 5 دقیقه)
                // تا حافظه سرور پر نشود
                setTimeout(() => {
                    delete sessionTargetMap[newSessionHash];
                    console.log(`SESSION ${newSessionHash} -> Expired and removed.`);
                }, 300000); // 5 minutes in milliseconds
            }
            
            return targetHost;
        }

        // برای هر حالت دیگری، به صورت پیش فرض به سرور اول می فرستیم (این حالت نباید زیاد رخ دهد)
        console.warn(`Unhandled path: ${req.path}. Falling back to default.`);
        return HF_TARGETS[0];
    }, 
    {
        https: true,
        // این تابع دیگر نیازی به تغییر ندارد چون مسیرها ساده هستند
        proxyReqPathResolver: function (req) {
            return req.originalUrl;
        },
        proxyErrorHandler: function (err, res, next) {
            console.error('Proxy error encountered:', err);
            res.status(502).send('Proxy Error: Could not connect to the AI service.');
        },
        // این بخش برای خواندن req.body در درخواست POST ضروری است
        parseReqBody: true
    }
));

// برای هر مسیر دیگری، فایل اصلی برنامه را نمایش بده
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// اجرای سرور
app.listen(PORT, () => {
    console.log(`Server-side Load Balancer listening on port ${PORT}`);
    console.log('Distributing load across:', HF_TARGETS);
});
