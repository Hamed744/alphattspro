const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const USAGE_LIMIT_TTS = 5;
const PODCAST_SPACE_URL = 'https://ezmary-padgenpro2.hf.space/';

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
// یک Set برای نگهداری شناسه‌هایی که اعتبارشان کسر شده است
const processed_job_ids = new Set();

console.log("Server started with Job ID based credit system.");

const getUserIp = (req) => {
    // مهم: پراکسی وردپرس باید هدر 'x-forwarded-for' را ارسال کند
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress;
};

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));


// --- شروع بخش امنیتی اضافه شده ---

// این Middleware برای بررسی کلید مخفی API است
const authMiddleware = (req, res, next) => {
    const receivedSecret = req.headers['x-internal-api-key'];
    const expectedSecret = process.env.INTERNAL_API_SECRET;

    // اگر کلید مخفی در Render تنظیم نشده باشد یا کلید ارسال شده توسط کلاینت اشتباه باشد، درخواست را با خطای 403 رد می‌کند
    if (!expectedSecret || receivedSecret !== expectedSecret) {
        console.warn(`Forbidden attempt with incorrect API key from IP: ${getUserIp(req)}`);
        return res.status(403).json({ message: 'Forbidden: You do not have permission to access this resource.' });
    }
    
    // اگر کلید صحیح بود، به درخواست اجازه ادامه می‌دهد
    next();
};

// Middleware امنیتی را قبل از تمام روت‌های /api/ اعمال می‌کنیم
app.use('/api/', authMiddleware);

// --- پایان بخش امنیتی اضافه شده ---


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
    const referer = req.headers['referer'];
    if (referer && referer.startsWith(PODCAST_SPACE_URL)) {
        return next();
    }

    const { fingerprint, subscriptionStatus, jobId } = req.body;
    
    if (!fingerprint) {
        return res.status(400).json({ message: "Fingerprint is required for this request." });
    }

    if (subscriptionStatus === 'paid') {
        return next();
    }

    // اگر درخواست دارای شناسه عملیات (jobId) است و این شناسه قبلا پردازش شده، اجازه عبور بده
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
        // فقط در صورتی اعتبار را کم کن که اولین درخواست از یک عملیات جدید باشد یا عملیات شناسه نداشته باشد
        user_record.count++;
        if (!user_record.ips.includes(currentIp)) {
            user_record.ips.push(currentIp);
        }
    } else {
        user_record = { fingerprint, ips: [currentIp], count: 1, last_reset: today };
        usage_data_cache.push(user_record);
    }

    // اگر درخواست دارای شناسه عملیات بود، آن را به لیست پردازش شده‌ها اضافه کن
    if (jobId) {
        processed_job_ids.add(jobId);
        console.log(`First request for Job ID ${jobId}. Credit consumed. User has ${USAGE_LIMIT_TTS - user_record.count} credits left.`);
        // شناسه را پس از ۱۰ دقیقه پاک کن تا حافظه پر نشود
        setTimeout(() => {
            processed_job_ids.delete(jobId);
            console.log(`Job ID ${jobId} expired and removed from cache.`);
        }, 10 * 60 * 1000); // 10 minutes
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
            // حذف فیلدهای اضافی قبل از ارسال به سرویس هوش مصنوعی
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
