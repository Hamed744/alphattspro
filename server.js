const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- پیکربندی هوشمند از طریق متغیرهای محیطی ---

// 1. خواندن نام پایه اسپیس‌ها از Environment Variables
// مثال: 'hamed744-ttspro'
const HF_SPACE_BASENAME = process.env.HF_SPACE_BASENAME;

// 2. خواندن تعداد کل اسپیس‌ها از Environment Variables
// مثال: '3'
const HF_SPACE_COUNT = parseInt(process.env.HF_SPACE_COUNT || '1', 10);

// بررسی اینکه آیا متغیرهای اصلی تنظیم شده‌اند
if (!HF_SPACE_BASENAME) {
    console.error('CRITICAL ERROR: Environment variable HF_SPACE_BASENAME is not set.');
    console.error('Application cannot start without it. Please set it in your Render.com dashboard.');
    process.exit(1); // خروج از برنامه اگر متغیر اصلی تنظیم نشده باشد
}

// شمارنده برای دنبال کردن اسپیس بعدی
let currentTargetIndex = 0;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// میدل‌ور پراکسی با منطق تولید لینک پویا
app.use('/gradio_api', proxy(
    (req) => {
        // --- منطق چرخشی و تولید لینک ---

        // اسپیس اول شماره ندارد، اسپیس‌های بعدی شماره ۲، ۳، و ... دارند.
        // اگر ایندکس 0 باشد -> پسوندی ندارد
        // اگر ایندکس 1 باشد -> پسوند '2' اضافه می‌شود
        // اگر ایندکس 2 باشد -> پسوند '3' اضافه می‌شود
        const suffix = currentTargetIndex === 0 ? '' : (currentTargetIndex + 1).toString();

        // ساختن هاست هدف به صورت پویا
        const targetHost = `${HF_SPACE_BASENAME}${suffix}.hf.space`;

        // لاگ برای دیباگ کردن: نمایش می‌دهد که درخواست به کدام اسپیس ارسال شد
        console.log(`[Round-Robin] Routing request to: ${targetHost} (Index: ${currentTargetIndex})`);

        // به‌روزرسانی شمارنده برای درخواست بعدی (منطق چرخشی)
        currentTargetIndex = (currentTargetIndex + 1) % HF_SPACE_COUNT;

        // بازگرداندن هاست هدف برای این درخواست
        return targetHost;
    },
    {
        https: true, // اتصال امن به Hugging Face
        proxyReqPathResolver: function (req) {
            return req.originalUrl;
        },
        proxyErrorHandler: function (err, res, next) {
            console.error('Proxy error encountered:', err);
            res.status(502).send('An error occurred while connecting to the AI service.');
        }
    }
));

// Fallback for any other route - serve your index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Smart Proxy Server listening on port ${PORT}`);
    console.log(`Base Name: ${HF_SPACE_BASENAME}`);
    console.log(`Total Spaces configured: ${HF_SPACE_COUNT}`);
});
