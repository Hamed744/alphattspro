const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const USAGE_LIMIT_TTS = 5;

// START: لیست آدرس‌های مجاز
// تمام آدرس‌هایی که می‌خواهید به این سرویس دسترسی داشته باشند را اینجا اضافه کنید
const ALLOWED_REFERERS = [
    'https://alphattspro3.onrender.com',      // آدرس خود اپلیکیشن Render
    'https://hamed744-chatlala44free.hf.space', // آدرس جدید چت‌بات شما
    'https://ezmary-padgenpro2.hf.space'       // آدرس قدیمی (اگر هنوز لازم است)
];
// END: لیست آدرس‌های مجاز

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

let usage_data_cache = [];
const processed_job_ids = new Set();

console.log("Server started with Job ID based credit system.");

const getUserIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress;
};

// --- کد امنیتی اصلاح شده و بهینه ---
const authMiddleware = (req, res, next) => {
    const referer = req.headers.referer;
    const origin = req.headers.origin;

    // 1. بررسی با کلید مخفی (برای دسترسی‌های سرور-به-سرور)
    const receivedSecret = req.headers['x-internal-api-key'];
    const expectedSecret = process.env.INTERNAL_API_SECRET;
    if (expectedSecret && receivedSecret === expectedSecret) {
        return next();
    }

    // 2. بررسی آدرس‌های مجاز در لیست ALLOWED_REFERERS
    const requestSource = referer || origin;
    if (requestSource && ALLOWED_REFERERS.some(allowedUrl => requestSource.startsWith(allowedUrl))) {
        return next(); // اجازه عبور
    }

    // 3. اگر هیچ‌کدام از شرایط برقرار نبود، دسترسی را مسدود می‌کند
    console.warn(`Forbidden attempt from IP: ${getUserIp(req)} with referer: ${referer} and origin: ${origin}`);
    return res.status(403).json({ message: 'Forbidden: You do not have permission to access this resource.' });
};
// --- END ---

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- اعمال میان‌افزار امنیتی بر روی تمام مسیرهای /api/ ---
app.use('/api/', authMiddleware);

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

const creditCheckMiddleware = (req, res, next) => {
    // چون چک کردن دسترسی در authMiddleware انجام می‌شود، این بخش را ساده‌تر می‌کنیم
    const { fingerprint, subscriptionStatus, jobId } = req.body;
    
    if (!fingerprint) {
        return res.status(400).json({ message: "Fingerprint is required for this request." });
    }

    if (subscriptionStatus === 'paid') {
        return next();
    }

    if (jobId && processed_job_ids.has(jobId)) {
        console.log(`Job ID ${jobId} already processed. Bypassing credit check.`);
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

    if (jobId) {
        processed_job_ids.add(jobId);
        console.log(`First request for Job ID ${jobId}. Credit consumed. User has ${USAGE_LIMIT_TTS - user_record.count} credits left.`);
        setTimeout(() => {
            processed_job_ids.delete(jobId);
            console.log(`Job ID ${jobId} expired and removed from cache.`);
        }, 10 * 60 * 1000);
    } else {
         console.log(`Single request (no Job ID). Credit consumed. User has ${USAGE_LIMIT_TTS - user_record.count} credits left.`);
    }

    next();
};

app.use('/api/generate', creditCheckMiddleware, proxy(() => {
    const worker = getNextWorker();
    console.log(`Forwarding request to worker: ${worker}`);
    return `https://${worker}`;
}, {
    https: true,
    proxyReqPathResolver: (req) => '/generate',
    proxyReqBodyDecorator: (bodyContent, srcReq) => {
        if (bodyContent) {
            delete bodyContent.fingerprint;
            delete bodyContent.subscriptionStatus;
            delete bodyContent.jobId;
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
    console.log(`Smart proxy server listening on port ${PORT}`);
});
