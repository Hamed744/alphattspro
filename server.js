const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// نقشه ای از کلیدهای ساده به آدرس کامل اسپیس ها
// این کار باعث می شود کد سمت کاربر تمیزتر باشد
const HF_TARGETS = {
    'space1': 'hamed744-ttspro.hf.space',
    'space2': 'hamed744-ttspro2.hf.space',
    'space3': 'hamed744-ttspro3.hf.space'
};

// سرویس دهی فایل های استاتیک مثل index.html
app.use(express.static(path.join(__dirname, 'public')));

// *** بخش اصلی تغییرات اینجاست ***
// ما یک پارامتر داینامیک به نام targetKey به مسیر اضافه می کنیم
// مثلا: /space1/gradio_api/... یا /space2/gradio_api/...
app.use('/:targetKey/gradio_api', proxy(
    (req) => {
        const targetKey = req.params.targetKey;
        // آدرس اسپیس مورد نظر را از روی نقشه پیدا می کنیم
        const targetHost = HF_TARGETS[targetKey];
        
        // اگر کلید معتبر بود، آدرس آن را برمیگردانیم
        if (targetHost) {
            console.log(`Proxying request for key '${targetKey}' to -> ${targetHost}`);
            return targetHost;
        }
        
        // در صورت ارسال کلید نامعتبر، به یک مقصد پیش فرض ارسال می کنیم
        console.warn(`Invalid target key '${targetKey}'. Falling back to default.`);
        return HF_TARGETS['space1']; 
    }, 
    {
        https: true, // اتصال امن به Hugging Face
        proxyReqPathResolver: function (req) {
            // مسیر اصلی درخواست را بازسازی می کنیم
            // مثال: /space1/gradio_api/queue/join  ->  /gradio_api/queue/join
            const originalPath = req.originalUrl;
            const targetKey = req.params.targetKey;
            const resolvedPath = originalPath.replace(`/${targetKey}`, '');
            return resolvedPath;
        },
        proxyErrorHandler: function (err, res, next) {
            console.error('Proxy error encountered:', err);
            res.status(502).send('Proxy Error: Could not connect to the AI service.');
        }
    }
));

// برای هر مسیر دیگری، فایل اصلی برنامه را نمایش بده
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// اجرای سرور
app.listen(PORT, () => {
    console.log(`Smart proxy server listening on port ${PORT}`);
    console.log('Available targets:', HF_TARGETS);
});
