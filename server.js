const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const USAGE_LIMIT_TTS = 5;

// START: آدرس های مجاز در یک لیست قرار گرفتند
const ALLOWED_HF_SPACES = [
    'https://ezmary-padgenpro2.hf.space/',
    'https://hamed744-chatlala49free.hf.space/' // <-- آدرس چت بات شما اینجا اضافه شد
];
// END: اصلاح

const RENDER_APP_URL = 'https://alphattspro3.onrender.com'; // <-- آدرس اپلیکیشن رندر شما

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

// --- START: کد امنیتی اصلاح شده ---
const authMiddleware = (req, res, next) => {
    const referer = req.headers.referer;
    const origin = req.headers.origin;

    // 1. بررسی می‌کند آیا درخواست از طرف خود اپلیکیشن Render است
    if ((referer && referer.startsWith(RENDER_APP_URL)) || (origin && origin.startsWith(RENDER_APP_URL))) {
        return next(); // اجازه عبور بده
    }
    
    // 2. بررسی می‌کند آیا درخواست از طرف سرور وردپرس ما (با کلید مخفی) آمده است
    const receivedSecret = req.headers['x-internal-api-key'];
    const expectedSecret = process.env.INTERNAL_API_SECRET;

    if (expectedSecret && receivedSecret === expectedSecret) {
        return next(); // اجازه عبور بده
    }

    // 3. اگر کلید مخفی وجود نداشت، بررسی می‌کند آیا درخواست از طرف یکی از Spaceهای مجاز است
    if (referer && ALLOWED_HF_SPACES.some(url => referer.startsWith(url))) {
        return next(); // اجازه عبور بده
    }

    // 4. اگر هیچ‌کدام از شرایط بالا برقرار نبود، دسترسی را مسدود می‌کند
    console.warn(`Forbidden attempt from IP: ${getUserIp(req)} with referer: ${referer} and origin: ${origin}`);
    return res.status(403).json({ message: 'Forbidden: You do not have permission to access this resource.' });
};
// --- END: کد امنیتی اصلاح شده ---

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- اعمال میان‌افزار امنیتی بر روی تمام مسیرهای /api/ ---
app.use('/api/', authMiddleware);

// تمام کدهای زیر دقیقاً مانند قبل و بدون تغییر هستند
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
    const referer = req.headers.referer;
    // START: اصلاح منطق برای بررسی لیست آدرس‌ها
    if (referer && ALLOWED_HF_SPACES.some(url => referer.startsWith(url))) {
        return next();
    }
    // END: اصلاح منطق

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
