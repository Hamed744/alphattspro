const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ====================================================================
// ۱. لیست تمام اسپیس‌های شما در اینجا قرار دارد
// ====================================================================
const HF_SPACES = [
    'hamed744-ttspro.hf.space',   // اسپیس اصلی
    'hamed744-ttspro2.hf.space',  // اسپیس دوم
    'hamed744-ttspro3.hf.space'   // اسپیس سوم
];

// متغیری برای نگه‌داری ایندکس اسپیس بعدی که باید استفاده شود
let currentSpaceIndex = 0;

console.log(`✅ Load balancer configured with ${HF_SPACES.length} target spaces.`);

// ====================================================================
// ۲. سرور فایل‌های استاتیک (HTML, CSS, JS) شما را ارائه می‌دهد
// ====================================================================
// این بخش بدون تغییر باقی می‌ماند
app.use(express.static(path.join(__dirname, 'public')));


// ====================================================================
// ۳. منطق اصلی توزیع بار (Load Balancer)
// ====================================================================
// به جای استفاده مستقیم از پروکسی، یک میان‌افزار (middleware) ایجاد می‌کنیم
// تا قبل از ارسال هر درخواست، یک اسپیس را به صورت چرخشی انتخاب کند.
app.use('/gradio_api', (req, res, next) => {
    
    // انتخاب اسپیس هدف از لیست
    const targetSpace = HF_SPACES[currentSpaceIndex];
    
    // به‌روزرسانی ایندکس برای درخواست بعدی (الگوریتم چرخشی یا Round-Robin)
    currentSpaceIndex = (currentSpaceIndex + 1) % HF_SPACES.length;
    
    // لاگ کردن برای اینکه ببینیم هر درخواست به کدام اسپیس می‌رود (برای دیباگ)
    console.log(`[${new Date().toISOString()}] Forwarding request to: ${targetSpace}${req.originalUrl}`);
    
    // اجرای پروکسی با هدف داینامیکی که انتخاب کردیم
    proxy(targetSpace, {
        https: true, // اتصال امن به هاگینگ فیس
        proxyReqPathResolver: function (proxyReq) {
            // مسیر کامل درخواست را بدون تغییر ارسال می‌کند
            return proxyReq.originalUrl;
        },
        proxyErrorHandler: function (err, proxyRes, next) {
            console.error(`❌ Proxy error for target ${targetSpace}:`, err);
            // به کاربر یک پیام خطای عمومی نشان می‌دهد
            if (!proxyRes.headersSent) {
                proxyRes.status(503).send('سرویس هوش مصنوعی در حال حاضر در دسترس نیست. لطفا بعدا تلاش کنید.');
            }
        }
    })(req, res, next);
});


// ====================================================================
// ۴. مسیر Fallback برای Single Page Application
// ====================================================================
// این بخش تضمین می‌کند که اگر کاربر مستقیماً به آدرسی غیر از ریشه مراجعه کرد،
// همچنان فایل index.html بارگذاری شود.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// ====================================================================
// ۵. راه‌اندازی سرور
// ====================================================================
app.listen(PORT, () => {
    console.log(`🚀 Proxy server with load balancing is running on port ${PORT}`);
    console.log(`Your application is accessible at your Render.com URL.`);
});
