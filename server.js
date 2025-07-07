const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. لیست اسپیس‌های Hugging Face شما
// به جای یک هدف ثابت، یک آرایه از اهداف تعریف می‌کنیم.
const HF_TARGETS = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];

// 2. یک شمارنده برای دنبال کردن اسپیس بعدی
// این متغیر باید بیرون از میدل‌ور پراکسی باشد تا مقدارش بین درخواست‌ها حفظ شود.
let currentTargetIndex = 0;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// 3. تغییر در میدل‌ور پراکسی
// ما اولین آرگومان تابع proxy را از یک رشته ثابت به یک تابع تغییر می‌دهیم.
// این تابع برای هر درخواست اجرا شده و به صورت پویا تصمیم می‌گیرد که درخواست به کدام هاست ارسال شود.
app.use('/gradio_api', proxy(
    (req) => {
        // انتخاب هدف برای این درخواست بر اساس شمارنده فعلی
        const selectedTarget = HF_TARGETS[currentTargetIndex];

        // برای دیباگ کردن: در لاگ‌های سرور (Render) نمایش می‌دهد که درخواست به کدام اسپیس ارسال شد
        console.log(`[${new Date().toISOString()}] Routing request to: ${selectedTarget}`);

        // به‌روزرسانی شمارنده برای درخواست بعدی (منطق چرخشی)
        // از اپراتور باقیمانده (%) استفاده می‌کنیم تا شمارنده به صورت چرخشی در محدوده طول آرایه باقی بماند.
        currentTargetIndex = (currentTargetIndex + 1) % HF_TARGETS.length;

        // بازگرداندن هدف انتخابی برای این درخواست
        return selectedTarget;
    },
    {
        https: true, // Crucial for connecting to Hugging Face securely
        proxyReqPathResolver: function (req) {
            // این بخش بدون تغییر باقی می‌ماند و به درستی کار می‌کند
            return req.originalUrl;
        },
        proxyErrorHandler: function (err, res, next) {
            console.error('Proxy error encountered:', err);
            // می‌توانید در اینجا یک منطق بازگشتی (retry) ساده هم اضافه کنید،
            // اما برای شروع همین کافی است.
            res.status(502).send('An error occurred while connecting to the AI service. Please try again later.');
        }
    }
));

// Fallback for any other route - serve your index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Proxy server with Round-Robin logic listening on port ${PORT}`);
    console.log(`Targeting ${HF_TARGETS.length} Hugging Face Spaces.`);
});
