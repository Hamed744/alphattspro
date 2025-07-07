// server.js
// این کد نهایی و صحیح برای توزیع بار بین سه اسپیس شماست.

const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// لیست آدرس‌های Hugging Face Space شما
const HF_TARGETS = [
    'hamed744-ttspro.hf.space',   // اسپیس اول (مطمئن شوید فعال است)
    'hamed744-ttspro2.hf.space',  // اسپیس دوم (مطمئن شوید فعال است)
    'hamed744-ttspro3.hf.space'   // اسپیس سوم (مطمئن شوید فعال است)
];

// این متغیر، شماره اسپیسی که باید درخواست بعدی را دریافت کند، نگه می‌دارد.
let currentTargetIndex = 0;

// این بخش فایل‌های استاتیک مثل index.html را سرو می‌کند.
app.use(express.static(path.join(__dirname, 'public')));

// این بخش مهم، تمام درخواست‌های API را مدیریت می‌کند.
// این یک "middleware" است که قبل از هر درخواست به مسیر /gradio_api اجرا می‌شود.
app.use('/gradio_api', (req, res, next) => {
    // 1. انتخاب اسپیس بعدی به صورت چرخشی (Round-Robin)
    const target = HF_TARGETS[currentTargetIndex];

    // 2. ایندکس را برای درخواست بعدی یک واحد جلو می‌بریم.
    // عملگر % باعث می‌شود که بعد از آخرین اسپیس، دوباره به اولین اسپیس برگردیم.
    currentTargetIndex = (currentTargetIndex + 1) % HF_TARGETS.length;

    // این لاگ برای دیباگ کردن بسیار مفید است. شما می‌توانید در لاگ‌های رندر ببینید هر درخواست به کدام اسپیس ارسال شده است.
    console.log(`[Load Balancer] Forwarding request to: ${target}`);

    // 3. حالا که هدف (target) مشخص شد، پروکسی را با آن هدف اجرا می‌کنیم.
    // این بخش درخواست را به اسپیس انتخاب شده ارسال می‌کند.
    proxy(target, {
        https: true,
        proxyReqPathResolver: function (proxyReq) {
            return proxyReq.originalUrl;
        },
        proxyErrorHandler: function (err, proxyRes, next) {
            console.error(`[Proxy Error] Could not connect to ${target}. Error: ${err.message}`);
            proxyRes.status(503).send('The AI service is temporarily unavailable. Please try again.'); // 503 Service Unavailable
        }
    })(req, res, next); // این فراخوانی برای اجرای پروکسی ضروری است.
});

// این بخش اطمینان می‌دهد که همه مسیرهای دیگر به صفحه اصلی شما هدایت می‌شوند.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// سرور را اجرا می‌کند
app.listen(PORT, () => {
    console.log(`🚀 Alpha TTS server with Load Balancing is running on port ${PORT}`);
    console.log(`Total Spaces in rotation: ${HF_TARGETS.length}`);
});
