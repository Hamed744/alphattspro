const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- تنظیمات اصلی ---
const USAGE_LIMIT_TTS = 5; // محدودیت روزانه برای کاربران رایگان

// --- تنظیمات پراکسی (بدون تغییر) ---
const HF_WORKERS = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];
let nextWorkerIndex = 0;
const getNextWorker = () => {
    const worker = HF_WORKERS[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % HF_WORKERS.length;
    return worker;
};

// --- مدیریت داده‌های کاربران در حافظه موقت (In-Memory) ---
// ساختار جدید: { fingerprint: "...", ips: ["...", "..."], count: 0, last_reset: "..." }
let usage_data_cache = [];
console.log("Server started in in-memory mode with IP + Fingerprint tracking.");

// --- توابع کمکی ---

// تابع برای دریافت IP کاربر (سازگار با Render)
const getUserIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress;
};

// --- Middleware ها و API Endpoints ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API برای چک کردن اعتبار کاربر
app.post('/api/check-credit-tts', (req, res) => {
    const { fingerprint, subscriptionStatus } = req.body;
    if (!fingerprint) {
        return res.status(400).json({ message: "Fingerprint is required." });
    }

    if (subscriptionStatus === 'paid') {
        return res.json({ credits_remaining: 'unlimited', limit_reached: false });
    }

    const currentIp = getUserIp(req);
    const today = new Date().toISOString().split('T')[0];

    // جستجو بر اساس اثر انگشت یا IP
    let user_record = usage_data_cache.find(u =>
        u.fingerprint === fingerprint || u.ips.includes(currentIp)
    );

    let credits_remaining = USAGE_LIMIT_TTS;
    if (user_record) {
        // ریست روزانه اعتبار
        if (user_record.last_reset !== today) {
            user_record.count = 0;
            user_record.last_reset = today;
        }
        credits_remaining = Math.max(0, USAGE_LIMIT_TTS - user_record.count);
    }

    res.json({
        credits_remaining,
        limit_reached: credits_remaining <= 0
    });
});

// Middleware برای کنترل دسترسی و کسر اعتبار قبل از تولید صدا
const creditCheckMiddleware = (req, res, next) => {
    const { fingerprint, subscriptionStatus } = req.body;
    if (!fingerprint) {
        return res.status(400).json({ message: "Fingerprint is required." });
    }

    if (subscriptionStatus === 'paid') {
        return next();
    }

    // منطق پیشرفته برای کاربران رایگان
    const currentIp = getUserIp(req);
    const today = new Date().toISOString().split('T')[0];

    // جستجو بر اساس اثر انگشت یا IP
    let user_record = usage_data_cache.find(u =>
        u.fingerprint === fingerprint || u.ips.includes(currentIp)
    );

    if (user_record) {
        // کاربر موجود پیدا شد
        // ریست کردن اعتبار در صورت تغییر روز
        if (user_record.last_reset !== today) {
            user_record.count = 0;
            user_record.last_reset = today;
            user_record.ips = [currentIp]; // لیست IP ها را هم برای روز جدید ریست می‌کنیم
        }

        // چک کردن اتمام اعتبار
        if (user_record.count >= USAGE_LIMIT_TTS) {
            return res.status(429).json({
                message: "شما به محدودیت روزانه خود برای تولید صدا رسیده‌اید. هر روز بصورت رایگان امکان ساخت پنج صدا وجود داره برای استفاده نامحدود اشتراک خریداری کنید و از همه بخش های برنامه بصورت نامحدود با داشتن اشتراک استفاده کنید.",
                credits_remaining: 0
            });
        }
        
        // کسر یک اعتبار
        user_record.count++;

        // اضافه کردن IP جدید به لیست در صورت عدم وجود
        if (!user_record.ips.includes(currentIp)) {
            user_record.ips.push(currentIp);
        }

    } else {
        // ساخت رکورد برای کاربر کاملاً جدید
        user_record = {
            fingerprint,
            ips: [currentIp],
            count: 1,
            last_reset: today
        };
        usage_data_cache.push(user_record);
    }

    console.log(`Free user (fp: ${fingerprint}, ip: ${currentIp}) used a credit. Remaining today: ${USAGE_LIMIT_TTS - user_record.count}`);
    next();
};

// API اصلی برای تولید صدا
app.use('/api/generate', creditCheckMiddleware, proxy(() => {
    const worker = getNextWorker();
    console.log(`Forwarding request to worker (Round-robin): ${worker}`);
    return `https://${worker}`;
}, {
    https: true,
    proxyReqPathResolver: (req) => '/generate',
    proxyReqBodyDecorator: (bodyContent, srcReq) => {
        if (bodyContent) {
            delete bodyContent.fingerprint;
            delete bodyContent.subscriptionStatus;
        }
        return bodyContent;
    },
    proxyErrorHandler: (err, res, next) => {
        console.error('Proxy Error:', err);
        res.status(502).send('Error connecting to the AI service. Please try again.');
    }
}));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// اجرای سرور
app.listen(PORT, () => {
    console.log(`Smart proxy server with in-memory credit system listening on port ${PORT}`);
    console.log(`Distributing load across (Round-robin): ${HF_WORKERS.join(', ')}`);
});
