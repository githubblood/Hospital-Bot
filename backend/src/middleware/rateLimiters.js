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

// Password reset was previously completely unlimited on both ends (Stage 3.5
// hardening) — forgotPassword sends a real outbound WhatsApp message per
// call (cost/spam vector), and resetPassword checks a 6-digit code that,
// with no rate limit, is brute-forceable well within its 10-minute TTL.
// Tighter than loginLimiter for the same reason registerLimiter is: each
// accepted request has a real side effect (a WhatsApp send) rather than just
// a password comparison.
const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many password reset requests. Please try again later.' }
});

// Looser than forgotPasswordLimiter (legitimate users mistyping a 6-digit
// code need a few tries) — the real brute-force backstop here is the
// per-account failed-attempt lockout in adminAuthController.resetPassword,
// not this IP-level limiter alone.
const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' }
});

// A separate instance (not a reuse of loginLimiter) so a burst of hospital
// login attempts from one IP can't eat into the platform login budget for
// that same IP, or vice versa — they're different authentication realms and
// shouldn't share a rate-limit bucket even though the numbers happen to match.
const platformLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in a few minutes.' }
});

module.exports = {
    loginLimiter, webhookLimiter, registerLimiter, forgotPasswordLimiter, resetPasswordLimiter,
    platformLoginLimiter
};
