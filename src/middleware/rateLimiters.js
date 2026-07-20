const rateLimit = require('express-rate-limit');

// Login has no other brute-force protection (no account lockout, no CAPTCHA)
// — this is the one real backstop against password guessing. Keyed by IP
// (express-rate-limit's default), which is the right dimension for a login
// endpoint (an attacker trying many emails from one IP is exactly what this
// should slow down).
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in a few minutes.' }
});

// The webhook is unauthenticated by design (Meta calls it, not a logged-in
// user) and now has signature verification (verifyMetaSignature.js), but a
// generous ceiling still guards against it being used as a free WhatsApp-send
// amplifier or a DB-load hammer if the URL leaks. Meta's own retry behavior
// (a few retries per message over ~2 days) sits well under this.
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests.' }
});

// Hospital self-registration creates real DB rows (a hospital + its first
// admin) on every accepted request — a much heavier and more abuse-prone
// action than a login attempt, so this is deliberately tighter than
// loginLimiter rather than reusing it.
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many registration attempts from this network. Please try again later.' }
});

module.exports = { loginLimiter, webhookLimiter, registerLimiter };
