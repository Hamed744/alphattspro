const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const USAGE_LIMIT_TTS = 5;
const RENDER_APP_URL = 'https://alphattspro1.onrender.com'; // آدرس اپلیکیشن رندر شما (برای تست خود برنامه)

// HF Workers and Load Balancing (بدون تغییر)
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

console.log("Server started with Job ID based credit system and secret key authentication.");

const getUserIp = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
};

// --- START: کد امنیتی اصلاح شده ---
const authMiddleware = (req, res, next) => {
    const referer = req.headers.referer;
    const origin = req.headers.origin;
    const receivedSecret = req.headers['x-internal-api-key'];
    const expectedSecret = process.env.INTERNAL_API_SECRET;

    // 1. درخواست از طرف خود اپلیکیشن Render (برای تست)
    if ((referer && referer.startsWith(RENDER_APP_URL)) || (origin && origin.startsWith(RENDER_APP_URL))) {
        return next();
    }
    
    // 2. درخواست از طرف سرور وردپرس با کلید مخفی
    if (expectedSecret && receivedSecret === expectedSecret) {
        // یک فلگ به درخواست اضافه می‌کنیم تا در مراحل بعد بدانیم این درخواست معتبر است
        req.isVerifiedProxy = true; 
        return next();
    }

    // 3. اگر هیچ‌کدام از شرایط بالا برقرار نبود، مسدود کن
    console.warn(`Forbidden attempt from IP: ${getUserIp(req)} with referer: ${referer}`);
    return res.status(403).json({ message: 'Forbidden' });
};

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/', authMiddleware);

// --- END: کد امنیتی اصلاح شده ---


// مسیر بررسی اعتبار (بدون تغییر)
app.post('/api/check-credit-tts', (req, res) => {
    const { fingerprint } = req.body;
    if (!fingerprint) {
        return res.status(400).json({ message: "Fingerprint is required." });
    }
    // این مسیر فقط برای کاربران رایگان است، پس منطق آن درست است
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


// --- START: میان‌افزار بررسی اعتبار کاملاً اصلاح شده ---
const creditCheckMiddleware = (req, res, next) => {
    // اگر درخواست از پراکسی معتبر ما آمده باشد (که خودش وضعیت اشتراک را چک کرده)
    // دیگر نیازی به بررسی اعتبار نیست و مستقیم عبور می‌کند.
    if (req.isVerifiedProxy) {
        console.log(`Request from verified proxy (IP: ${getUserIp(req)}). Bypassing credit check.`);
        return next();
    }

    // اگر کد به اینجا برسد، یعنی درخواست از پراکسی ما نیامده و باید کاربر رایگان در نظر گرفته شود
    // (این حالت بیشتر برای تست مستقیم از خود صفحه رندر اتفاق می‌افتد)
    
    console.log(`Request without verified proxy. Applying free tier limit.`);
    
    const { fingerprint, jobId } = req.body;
    
    if (!fingerprint) {
        return res.status(400).json({ message: "Fingerprint is required for this request." });
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
        }, 10 * 60 * 1000); // 10 minutes
    } else {
         console.log(`Single request (no Job ID). Credit consumed. User has ${USAGE_LIMIT_TTS - user_record.count} credits left.`);
    }

    next();
};
// --- END: میان‌افزار بررسی اعتبار کاملاً اصلاح شده ---


app.use('/api/generate', creditCheckMiddleware, proxy(() => {
    const worker = getNextWorker();
    console.log(`Forwarding request to worker: ${worker}`);
    return `https://${worker}`;
}, {
    https: true,
    proxyReqPathResolver: (req) => '/generate',
    proxyReqBodyDecorator: (bodyContent, srcReq) => {
        // تمام فیلدهای اضافی را حذف می‌کنیم تا به سرویس اصلی ارسال نشوند
        if (bodyContent) {
            delete bodyContent.fingerprint;
            delete bodyContent.subscriptionStatus; // این فیلد دیگر استفاده نمی‌شود
            delete bodyContent.jobId;
            delete bodyContent.email; // ایمیل هم نیازی به ارسال ندارد
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
