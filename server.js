const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');
const { HfApi } = require('@huggingface/hub');
const fs = require('fs/promises');

const app = express();
const PORT = process.env.PORT || 3000;

// --- تنظیمات اصلی ---
const HF_TOKEN = process.env.HF_TOKEN; // بسیار مهم: این را در متغیرهای محیطی Render تنظیم کنید
const DATASET_REPO = "Ezmary/Karbaran-rayegan-tedad";
const DATASET_FILENAME_TTS = "usage_data_tts.json";
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

// --- مدیریت داده‌های کاربران ---
let usage_data_cache = [];
let data_changed = false;
const api = new HfApi(HF_TOKEN);
const CACHE_FILE_PATH = path.join(__dirname, DATASET_FILENAME_TTS);

// تابع برای بارگذاری داده‌ها از هاگینگ فیس در ابتدای کار
const loadInitialData = async () => {
    if (!HF_TOKEN) {
        console.error("CRITICAL: Hugging Face Token (HF_TOKEN) is not set. Database features will be disabled.");
        return;
    }
    try {
        console.log(`Attempting to load data from '${DATASET_REPO}'...`);
        const fileUrl = await api.hf.hub.fileDownload({
            repo: { type: "dataset", name: DATASET_REPO },
            path: DATASET_FILENAME_TTS,
        });
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`Failed to download file with status: ${response.status}`);
        
        const content = await response.text();
        usage_data_cache = JSON.parse(content);
        console.log(`Successfully loaded ${usage_data_cache.length} TTS user records into memory.`);
    } catch (error) {
        if (error.message.includes('404')) {
            console.warn("TTS usage file not found in the repository. A new one will be created.");
            usage_data_cache = [];
        } else {
            console.error("Failed to load initial TTS data:", error);
        }
    }
};

// تابع برای ذخیره داده‌ها در هاگینگ فیس (فقط در صورت وجود تغییر)
const persistDataToHub = async () => {
    if (!data_changed || !HF_TOKEN) return;

    console.log("Change detected, preparing to write to Hugging Face Hub...");
    try {
        await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(usage_data_cache, null, 2));
        
        await api.uploadFile({
            repo: { type: "dataset", name: DATASET_REPO },
            pathOrBlob: CACHE_FILE_PATH,
            pathInRepo: DATASET_FILENAME_TTS,
        });
        
        await fs.unlink(CACHE_FILE_PATH);
        data_changed = false; // فلگ را ریست کن
        console.log(`Successfully persisted ${usage_data_cache.length} TTS records to the Hub.`);
    } catch (error) {
        console.error("CRITICAL: Failed to persist TTS data to Hub:", error);
    }
};

// هر 30 ثانیه یکبار داده‌ها را در صورت نیاز ذخیره کن
setInterval(persistDataToHub, 30000);

// --- Middleware ها و API Endpoints ---
app.use(express.json()); // برای خواندن JSON از body درخواست‌ها
app.use(express.static(path.join(__dirname, 'public')));

// API جدید برای چک کردن اعتبار کاربر
app.post('/api/check-credit-tts', (req, res) => {
    const { fingerprint, subscriptionStatus } = req.body;
    if (!fingerprint) {
        return res.status(400).json({ message: "Fingerprint is required." });
    }

    if (subscriptionStatus === 'paid') {
        return res.json({ credits_remaining: 'unlimited', limit_reached: false });
    }

    const today = new Date().toISOString().split('T')[0]; // تاریخ امروز به فرمت YYYY-MM-DD
    let user_record = usage_data_cache.find(u => u.fingerprint === fingerprint);
    
    let credits_remaining = USAGE_LIMIT_TTS;
    if (user_record) {
        if (user_record.last_reset !== today) {
            user_record.count = 0; // ریست کردن اعتبار
            user_record.last_reset = today;
            data_changed = true;
        }
        credits_remaining = Math.max(0, USAGE_LIMIT_TTS - user_record.count);
    }

    res.json({
        credits_remaining,
        limit_reached: credits_remaining <= 0
    });
});

// Middleware برای کنترل دسترسی قبل از ارسال به پراکسی
const creditCheckMiddleware = (req, res, next) => {
    const { fingerprint, subscriptionStatus } = req.body;
    if (!fingerprint) {
        return res.status(400).json({ message: "Fingerprint is required." });
    }

    // کاربران پولی دسترسی نامحدود دارند
    if (subscriptionStatus === 'paid') {
        return next();
    }

    // منطق برای کاربران رایگان
    const today = new Date().toISOString().split('T')[0];
    let user_record = usage_data_cache.find(u => u.fingerprint === fingerprint);

    if (user_record) {
        // اگر تاریخ آخرین استفاده برای امروز نیست، اعتبار را ریست کن
        if (user_record.last_reset !== today) {
            user_record.count = 0;
            user_record.last_reset = today;
        }
        
        if (user_record.count >= USAGE_LIMIT_TTS) {
            return res.status(429).json({ 
                message: "You have reached your daily limit for TTS generation.",
                credits_remaining: 0 
            });
        }
        
        user_record.count++;
    } else {
        // کاربر جدید
        user_record = { fingerprint, count: 1, last_reset: today };
        usage_data_cache.push(user_record);
    }
    
    data_changed = true;
    console.log(`Free user ${fingerprint} used a credit. Remaining: ${USAGE_LIMIT_TTS - user_record.count}`);
    next();
};

// API اصلی برای تولید صدا (حالا هوشمند شده)
app.use('/api/generate', creditCheckMiddleware, proxy(() => {
    const worker = getNextWorker(); 
    console.log(`Forwarding request to worker (Round-robin): ${worker}`);
    return `https://${worker}`;
}, {
    https: true,
    proxyReqPathResolver: (req) => '/generate',
    proxyReqBodyDecorator: (bodyContent, srcReq) => {
        // موارد مربوط به اعتبار را از body حذف کن تا به سرور اصلی ارسال نشود
        delete bodyContent.fingerprint;
        delete bodyContent.subscriptionStatus;
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

// سرور را بعد از بارگذاری داده‌های اولیه اجرا کن
loadInitialData().then(() => {
    app.listen(PORT, () => {
        console.log(`Smart proxy server with credit system listening on port ${PORT}`);
        console.log(`Distributing load across (Round-robin): ${HF_WORKERS.join(', ')}`);
    });
});
