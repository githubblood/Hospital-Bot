// Must be required before any routes are defined — it patches Express 4's
// router methods so an async handler that throws/rejects automatically
// forwards to the error middleware below, instead of crashing the process
// or hanging the request forever (Express 4 doesn't await handlers or catch
// async rejections on its own).
require('express-async-errors');

const express = require('express');
const helmet = require('helmet');
const path = require('path');
const webhookRoutes = require('./routes/webhookRoutes');
const adminRoutes = require('./routes/adminRoutes');
const platformRoutes = require('./routes/platformRoutes');

const app = express();

// CORS: only matters once the admin panel is deployed to a different origin
// than this API (e.g. Vercel + Railway) — same-origin requests (the default,
// Railway serving both) never hit the browser's CORS check at all. Empty/
// unset ALLOWED_ORIGIN means this adds no headers, so today's same-origin
// deployment is byte-for-byte unchanged. Auth here is a Bearer token (and a
// token query param for the SSE queue stream), never cookies, so no
// Access-Control-Allow-Credentials is needed.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
}

app.use(helmet({
    // This app serves plain HTML/JS/CSS with inline <script> theme-flash
    // guards and inline event-handler-free markup, but a strict default CSP
    // would still need real auditing (every inline <style> block, the SVG
    // data-driven charts, etc.) before enabling safely — done separately,
    // not as a drive-by default here, to avoid silently breaking pages.
    contentSecurityPolicy: false
}));

// Captures the raw request body alongside Express's normal JSON parsing —
// needed by verifyMetaSignature.js, which must hash the exact bytes Meta
// sent (a re-serialized JSON body won't produce the same HMAC).
app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
}));

app.use('/', webhookRoutes);
app.use('/api/admin', corsMiddleware, adminRoutes);
// Mounted separately from /api/admin (Stage 4A) — a distinct route
// namespace, not a sub-path, so a platform token and a hospital token are
// never even routed through the same middleware chain.
app.use('/api/platform', corsMiddleware, platformRoutes);
app.use('/admin', express.static(path.join(__dirname, 'admin/public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Global error handler — the backstop for every route now that
// express-async-errors forwards thrown/rejected errors here instead of
// crashing the process. Logs the full error server-side but never leaks
// stack traces or internals to the client.
app.use((err, req, res, next) => {
    console.error('Unhandled request error:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

module.exports = app;
