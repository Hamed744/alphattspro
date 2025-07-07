// server.js
// این کد با حفظ Content-Type از پاسخ هاگینگ فیس، مشکل پخش را حل می‌کند.

const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const HF_TARGETS = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];
let currentTargetIndex = 0;

app.use(express.static(path.join(__dirname, 'public')));

app.use('/gradio_api', (req, res, next) => {
    const target = HF_TARGETS[currentTargetIndex];
    currentTargetIndex = (currentTargetIndex + 1) % HF_TARGETS.length;

    console.log(`[Load Balancer] Forwarding request to: ${target}`);

    proxy(target, {
        https: true,
        // *** اضافه کردن preserveHostHeader: true ***
        // این کار باعث می‌شود هدر Host اصلی درخواست کاربر به جای هاست پروکسی به سرور هدف ارسال شود.
        // گاهی اوقات سرویس‌های پشتیبان برای تعیین نوع محتوا به این هدر نیاز دارند.
        preserveHostHeader: true, 
        
        proxyReqPathResolver: function (proxyReq) {
            return proxyReq.originalUrl;
        },
        // *** اضافه کردن onProxyRes برای بررسی و تغییر هدرها ***
        onProxyRes: function(proxyRes, req, res) {
            // این تابع زمانی اجرا می‌شود که پاسخ از هاگینگ فیس دریافت شده اما هنوز به مرورگر کاربر ارسال نشده است.
            // ما می‌توانیم هدرهای پاسخ را بررسی یا تغییر دهیم.
            
            // اگر Gradio یک Content-Type را ارسال کرده باشد، آن را حفظ می‌کنیم.
            // این برای فایل‌های صوتی حیاتی است.
            if (proxyRes.headers['content-type']) {
                res.setHeader('Content-Type', proxyRes.headers['content-type']);
            }
            // اگر فایل صوتی باشد و Gradio از Content-Length استفاده کرده باشد، آن را نیز حفظ می‌کنیم.
            if (proxyRes.headers['content-length']) {
                res.setHeader('Content-Length', proxyRes.headers['content-length']);
            }
            // برخی هدرهای مربوط به کش (cache) را می‌توان اضافه کرد تا مرورگر بهتر کار کند.
            // res.setHeader('Cache-Control', 'public, max-age=31536000'); // مثال: کش برای 1 سال
            // res.setHeader('Accept-Ranges', 'bytes'); // مهم برای پخش کننده‌های صوتی که قابلیت seek دارند.

            console.log(`[Proxy Response] Status: ${proxyRes.statusCode}, Content-Type: ${proxyRes.headers['content-type'] || 'N/A'}`);
            // console.log("All response headers:", proxyRes.headers); // برای دیباگ کاملتر
        },
        proxyErrorHandler: function (err, proxyRes, next) {
            console.error(`[Proxy Error] Could not connect to ${target}. Error: ${err.message}`);
            res.status(503).send('The AI service is temporarily unavailable. Please try again.');
        }
    })(req, res, next);
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Alpha TTS server with Load Balancing is running on port ${PORT}`);
    console.log(`Total Spaces in rotation: ${HF_TARGETS.length}`);
});
