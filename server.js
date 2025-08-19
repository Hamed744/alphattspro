const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- تنظیمات اصلی ---
const USAGE_LIMIT_TTS = 5; // محدودیت روزانه برای کاربران رایگان
// آدرس دقیق اسپیس پادکست خود را اینجا وارد کنید
const PODCAST_SPACE_URL = 'https://ezmary-padgenpro2.hf.space/';

// --- تنظیمات پراکسی ---
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

// --- مدیریت داده‌های کاربران در حافظه موقت ---
let usage_data_cache = [];
console.log("Server started in in-memory mode with IP + Fingerprint tracking.");

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
    let user_record = usage_data_cache.find(u => u.fingerprint === fingerprint || u.ips.includes(currentIp));
    let credits_remaining = USAGE_LIMIT_TTS;
    if (user_record) {
        if (user_record.last_reset !== today) {
            user_record.count = 0;
            user_record.last_reset = today;
        }
        credits_remaining = Math.max(0, USAGE_LIMIT_TTS - user_record.count);
    }
    res.json({ credits_remaining, limit_reached: credits_remaining <= 0 });
});

// Middleware برای کنترل دسترسی
const creditCheckMiddleware = (req, res, next) => {
    // *** شروع تغییر اصلی ***
    // 1. چک کردن هدر Referer برای شناسایی درخواست از اسپیس پادکست
    const referer = req.headers['referer'];
    if (referer && referer.startsWith(PODCAST_SPACE_URL)) {
        console.log(`Request from trusted Podcast Space (${referer}) detected. Bypassing credit check.`);
        return next(); // اجازه عبور نامحدود برای اسپیس پادکست
    }
    // *** پایان تغییر اصلی ***

    // 2. ادامه منطق قبلی برای کاربران عادی (از اپلیکیشن TTS)
    const { fingerprint, subscriptionStatus } = req.body;
    if (!fingerprint) {
        // اگر اثر انگشت وجود نداشته باشد (ممکن است درخواست از جای دیگری باشد)، آن را مسدود کن
        console.warn(`Blocking request with no fingerprint from referer: ${referer || 'none'}`);
        return res.status(400).json({ message: "Fingerprint is required for this request." });
    }

    if (subscriptionStatus === 'paid') {
        return next();
    }
    
    const currentIp = getUserIp(req);
    const today = new Date().toISOString().split('T')[0];
    let user_record = usage_data_cache.find(u => u.fingerprint === fingerprint || u.ips.includes(currentIp));

    if (user_record) {
        if (user_record.last_reset !== today) {
            user_record.count = 0;
            user_record.last_reset = today;
            user_record.ips = [currentIp];
        }
        if (user_record.count >= USAGE_LIMIT_TTS) {
            return res.status(429).json({ message: "شما به محدودیت روزانه خود برای تولید صدا رسیده‌اید...", credits_remaining: 0 });
        }
        user_record.count++;
        if (!user_record.ips.includes(currentIp)) {
            user_record.ips.push(currentIp);
        }
    } else {
        user_record = { fingerprint, ips: [currentIp], count: 1, last_reset: today };
        usage_data_cache.push(user_record);
    }

    console.log(`Free user (fp: ${fingerprint}, ip: ${currentIp}) used a credit. Remaining today: ${USAGE_LIMIT_TTS - user_record.count}`);
    next();
};

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

app.listen(PORT, () => {
    console.log(`Smart proxy server with in-memory credit system listening on port ${PORT}`);
    console.log(`Trusted Referer for unlimited access: ${PODCAST_SPACE_URL}`);
    console.log(`Distributing load across (Round-robin): ${HF_WORKERS.join(', ')}`);
});
