const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // رندر یک پورت می‌دهد، در غیر این صورت از 3000 استفاده می‌شود

// 1. لیستی از تمام آدرس‌های اسپیس شما
// هر سه آدرسی که ساختید اینجا قرار گرفته‌اند.
const HF_TARGETS = [
    'hamed744-ttspro.hf.space',   // اسپیس اول
    'hamed744-ttspro2.hf.space',  // اسپیس دوم
    'hamed744-ttspro3.hf.space'   // اسپیس سوم
];

// یک شمارنده برای انتخاب اسپیس بعدی
let currentTargetIndex = 0;

// سرو کردن فایل‌های استاتیک از پوشه 'public'
// این بخش فایل‌های index.html، CSS، JS و غیره شما را سرو می‌کند
app.use(express.static(path.join(__dirname, 'public')));

// 2. استفاده از یک Middleware برای توزیع بار (Load Balancing)
// این بخش مهم‌ترین تغییر است. به جای یک پروکسی ثابت، ما یک تابع تعریف می‌کنیم
// که قبل از هر درخواست پروکسی، هدف بعدی را انتخاب می‌کند.
app.use('/gradio_api', (req, res, next) => {
    // انتخاب اسپیس بعدی به صورت چرخشی (Round-Robin)
    const target = HF_TARGETS[currentTargetIndex];
    
    // ایندکس را برای درخواست بعدی یک واحد افزایش می‌دهیم
    // و اگر به انتهای لیست رسید، به اول برمی‌گردیم
    currentTargetIndex = (currentTargetIndex + 1) % HF_TARGETS.length;
    
    // لاگ کردن هدف برای دیباگ کردن (می‌توانید در لاگ‌های رندر ببینید)
    console.log(`[Load Balancer] Forwarding request to: ${target}`);

    // اجرای پروکسی با هدف داینامیکی که انتخاب کردیم
    proxy(target, {
        https: true, // اتصال امن به هاگینگ فیس
        proxyReqPathResolver: function (proxyReq) {
            // مسیر کامل درخواست کاربر را بازسازی و ارسال می‌کند
            // e.g., /gradio_api/queue/join -> /gradio_api/queue/join
            return proxyReq.originalUrl;
        },
        proxyErrorHandler: function (err, proxyRes, next) {
            console.error(`[Proxy Error] for target ${target}:`, err);
            // به جای بستن اتصال، به middleware بعدی برای مدیریت خطا می‌رود
            // یا یک پیام خطای بهتر به کاربر نشان می‌دهد.
            if (!proxyRes.headersSent) {
               proxyRes.status(503).send('An error occurred while connecting to one of the AI services. Please try again.');
            }
        }
    })(req, res, next);
});

// مسیر بازگشتی برای هر درخواست دیگری - فایل index.html را سرو می‌کند
// این برای Single-Page-Applications مهم است.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// شروع به کار سرور
app.listen(PORT, () => {
    console.log(`✅ Alpha TTS Proxy Server with Load Balancing is running on port ${PORT}`);
    console.log(`🚀 Now distributing traffic across ${HF_TARGETS.length} Hugging Face spaces.`);
    console.log(`Access your application at your Render.com URL`);
});
