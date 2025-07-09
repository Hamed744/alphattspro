const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const HF_WORKERS = [
    'hamed744-ttspro.hf.space',
    'hamed744-ttspro2.hf.space',
    'hamed744-ttspro3.hf.space'
];

// --- تغییر اصلی اینجاست ---
// یک متغیر برای نگهداری ایندکس سرور بعدی
let nextWorkerIndex = 0;

// تابع برای انتخاب سرور بعدی به ترتیب
const getNextWorker = () => {
    // سرور فعلی را انتخاب کن
    const worker = HF_WORKERS[nextWorkerIndex];
    
    // ایندکس را برای درخواست بعدی یک واحد افزایش بده
    nextWorkerIndex = (nextWorkerIndex + 1) % HF_WORKERS.length;
    
    return worker;
};
// --- پایان تغییر ---

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/generate', proxy(() => {
    // از تابع جدید برای انتخاب سرور به ترتیب استفاده می‌کنیم
    const worker = getNextWorker(); 
    console.log(`Forwarding request to worker (Round-robin): ${worker}`);
    return worker;
}, {
    https: true,
    proxyReqPathResolver: function (req) {
        return '/generate'; 
    },
    proxyErrorHandler: function (err, res, next) {
        console.error('Proxy Error:', err);
        res.status(502).send('Error connecting to the AI service. Please try again.');
    }
}));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Smart proxy server listening on port ${PORT}`);
    console.log(`Distributing load across (Round-robin): ${HF_WORKERS.join(', ')}`);
});
