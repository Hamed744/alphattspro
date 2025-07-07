const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. لیست اسپیس‌های هدف برای منطق چرخشی (Round-Robin)
// هر اسپیس جدیدی که می‌سازید، آدرس آن را به این لیست اضافه کنید.
const HF_TARGETS = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];

// یک شمارنده برای اینکه بدانیم نوبت کدام اسپیس است
let currentTargetIndex = 0;


// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));


// 2. پراکسی کردن درخواست‌ها با منطق چرخشی
// به جای یک آدرس ثابت، یک تابع به پراکسی می‌دهیم که هر بار یک آدرس را از لیست بالا انتخاب می‌کند.
app.use('/gradio_api', proxy(
    (req) => {
        // انتخاب هدف برای این درخواست
        const selectedTarget = HF_TARGETS[currentTargetIndex];

        // لاگ برای دیباگ کردن: نمایش می‌دهد که درخواست به کدام اسپیس ارسال شد
        console.log(`[Round-Robin] Routing request to: ${selectedTarget}`);

        // آماده‌سازی شمارنده برای درخواست بعدی
        currentTargetIndex = (currentTargetIndex + 1) % HF_TARGETS.length;

        // بازگرداندن آدرس انتخاب شده
        return selectedTarget;
    },
    {
        https: true, // اتصال امن به Hugging Face
        proxyReqPathResolver: function (req) {
            // این بخش بدون تغییر باقی می‌ماند و مسیر را به درستی ارسال می‌کند
            return req.originalUrl;
        },
        proxyErrorHandler: function (err, res, next) {
            console.error('Proxy error encountered:', err);
            res.status(500).send('An error occurred while connecting to the AI service. Please try again later.');
        }
    }
));


// Fallback for any other route - serve your index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Start the server
app.listen(PORT, () => {
    console.log(`Round-robin proxy server listening on port ${PORT}`);
    console.log(`Targeting ${HF_TARGETS.length} Hugging Face Spaces.`);
});
