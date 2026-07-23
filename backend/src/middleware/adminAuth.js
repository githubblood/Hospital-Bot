const crypto = require('crypto');
require('dotenv').config();

// Timing-safe comparison — a plain `!==` string compare leaks how many
// leading characters matched via response-time variance, a real (if narrow)
// side-channel for guessing a static API key. Both buffers must be the same
// length for timingSafeEqual to run at all, so a length mismatch is checked
// (and rejected) separately first, before ever calling it.
function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = function adminAuth(req, res, next) {
    const key = req.header('x-api-key');
    if (!key || !safeEqual(key, process.env.ADMIN_API_KEY)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};
