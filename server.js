const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- شروع تغییرات ---

// 1. لیست تمام اسپیس‌های Hugging Face شما
const HF_SPACES = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];

// 2. یک شمارنده برای انتخاب اسپیس بعدی
let currentSpaceIndex = 0;

// بررسی اینکه آیا اسپیسی در لیست وجود دارد یا نه
if (HF_SPACES.length === 0) {
    console.error("خطای حیاتی: هیچ آدرس اسپیسی در آرایه HF_SPACES تعریف نشده است. سرور متوقف می‌شود.");
    process.exit(1); // خروج از برنامه
}

// 3. تابع انتخاب‌کننده اسپیس به صورت چرخشی
const selectHost = (req) => {
    // اسپیس فعلی را بر اساس شمارنده انتخاب کن
    const selectedHost = HF_SPACES[currentSpaceIndex];

    // شمارنده را برای درخواست *بعدی* یک واحد افزایش بده
    // وقتی به انتهای لیست رسید، دوباره از صفر شروع می‌کند (منطق چرخشی)
    currentSpaceIndex = (currentSpaceIndex + 1) % HF_SPACES.length;
    
    // این لاگ به شما کمک می‌کند در لاگ‌های Render ببینید هر درخواست به کدام اسپیس ارسال می‌شود
    console.log(`[Proxy] Forwarding request for ${req.originalUrl} to -> ${selectedHost}`);
    
    // آدرس انتخاب شده را برای پراکسی برگردان
    return selectedHost;
};

// --- پایان تغییرات ---


// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Proxy all requests starting with /gradio_api to a dynamically selected Hugging Face Space
app.use('/gradio_api', proxy(
    // 4. به جای یک آدرس ثابت، از تابع انتخاب‌کننده استفاده می‌کنیم
    selectHost, 
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

// Fallback for any other route - serve your index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Proxy server listening on port ${PORT}`);
    console.log(`Application is ready and distributing requests across ${HF_SPACES.length} space(s).`);
});
