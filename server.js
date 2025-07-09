const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// لیست تمام سرورهای بک‌اند شما در هاگینگ فیس
const HF_WORKERS = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];

// تابع برای انتخاب یک سرور به صورت تصادفی
const getRandomWorker = () => {
    const randomIndex = Math.floor(Math.random() * HF_WORKERS.length);
    return HF_WORKERS[randomIndex];
};

// سرو کردن فایل‌های استاتیک (index.html شما)
app.use(express.static(path.join(__dirname, 'public')));

// پراکسی کردن تمام درخواست‌های API به یک سرور تصادفی
// توجه: آدرس API در فرانت‌اند شما باید /api/generate باشد
app.use('/api/generate', proxy(() => {
    const worker = getRandomWorker();
    console.log(`Forwarding request to worker: ${worker}`);
    return worker;
}, {
    https: true, // اتصال امن به هاگینگ فیس
    // مسیر درخواست را بازنویسی می‌کنیم تا با API جدید اسپیس‌ها هماهنگ باشد
    proxyReqPathResolver: function (req) {
        // درخواست از /api/generate به /generate تبدیل می‌شود
        return '/generate'; 
    },
    proxyErrorHandler: function (err, res, next) {
        console.error('Proxy Error:', err);
        res.status(502).send('Error connecting to the AI service. Please try again.');
    }
}));

// برای هر مسیر دیگری، صفحه اصلی را نمایش بده
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Smart proxy server listening on port ${PORT}`);
    console.log(`Distributing load across: ${HF_WORKERS.join(', ')}`);
});
