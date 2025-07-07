const express = require('express');
const proxy = require('express-http-proxy');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // Render will provide a PORT, otherwise use 3000

// Target Hugging Face Space URL
const HF_TARGET = 'hamed744-ttspro.hf.space';

// Serve static files from the 'public' directory
// This will serve your index.html, CSS, JS, etc.
app.use(express.static(path.join(__dirname, 'public')));

// Proxy all requests starting with /gradio_api to Hugging Face Space
// This handles:
// - /gradio_api/queue/join (POST)
// - /gradio_api/queue/data?session_hash=... (GET, including SSE streaming)
// - /gradio_api/file=... (GET, for audio files)
app.use('/gradio_api', proxy(HF_TARGET, {
    https: true, // Crucial for connecting to Hugging Face securely
    proxyReqPathResolver: function (req) {
        // Reconstructs the full path including the /gradio_api prefix and query parameters
        // req.originalUrl is perfect for this as it contains the full path from the client
        // e.g., /gradio_api/queue/data?session_hash=xyz will be forwarded as /gradio_api/queue/data?session_hash=xyz
        return req.originalUrl;
    },
    // Optional: Add error handling for proxy requests
    proxyErrorHandler: function (err, res, next) {
        console.error('Proxy error encountered:', err);
        res.status(500).send('An error occurred while connecting to the AI service. Please try again later.');
    }
}));

// Fallback for any other route - serve your index.html
// This is important for single-page applications or direct link access.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Proxy server listening on port ${PORT}`);
    console.log(`Access your application at: http://localhost:${PORT} (or your Render.com URL)`);
});
