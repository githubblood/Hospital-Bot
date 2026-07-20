const crypto = require('crypto');

// Verifies Meta's X-Hub-Signature-256 header on incoming webhook POSTs —
// without this, anyone who discovers the webhook URL can POST a forged
// "incoming WhatsApp message" payload impersonating any phone number,
// triggering fake bookings/cancellations or spamming outbound WhatsApp sends
// at the hospital's cost. Requires req.rawBody, captured by app.js's
// express.json({ verify }) hook, since the signature is computed over the
// exact raw bytes Meta sent — a re-serialized JSON body won't hash the same.
//
// META_APP_SECRET isn't configured in every existing deployment yet (it
// wasn't part of the original .env setup), so this only enforces the check
// once an operator has actually set it — logging a one-time startup warning
// otherwise, rather than breaking a webhook that was already working. Set
// META_APP_SECRET (Meta App Dashboard -> Settings -> Basic -> App Secret) to
// close this gap for real.
let warnedMissingSecret = false;

module.exports = function verifyMetaSignature(req, res, next) {
    const secret = process.env.META_APP_SECRET;
    if (!secret) {
        if (!warnedMissingSecret) {
            console.warn(
                'META_APP_SECRET is not set — webhook signature verification is DISABLED. ' +
                'Anyone with the webhook URL can send forged messages. Set META_APP_SECRET in .env to fix this.'
            );
            warnedMissingSecret = true;
        }
        return next();
    }

    const signatureHeader = req.header('X-Hub-Signature-256') || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.alloc(0)).digest('hex');

    const sigBuf = Buffer.from(signatureHeader);
    const expBuf = Buffer.from(expected);
    const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

    if (!valid) {
        console.error('Webhook signature verification failed — rejecting request.');
        return res.sendStatus(401);
    }

    next();
};
