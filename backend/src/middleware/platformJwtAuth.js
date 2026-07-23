const jwt = require('jsonwebtoken');
require('dotenv').config();

// Protects platform-panel API routes. Deliberately separate from jwtAuth.js
// rather than a shared "auth" middleware with a mode flag — the two token
// types must never be interchangeable, and keeping the check logic in two
// small, independent files makes that boundary something you can see, not
// something enforced by an if-branch buried in shared code.
//
// Same JWT_SECRET as jwtAuth.js (no separate signing key) — the token_type
// claim is what actually separates the two realms, not the secret. Unlike
// jwtAuth.js, there's no legacy "issued before token_type existed" case to
// tolerate here: every platform_admin token that will ever exist is issued
// by platformAuthController.login, which has always set token_type, so this
// can fail closed on anything else.
module.exports = function platformJwtAuth(req, res, next) {
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // A hospital_admin token is validly signed (same secret) but is the
    // wrong kind of principal for this route — 403, not 401, since the
    // credential itself isn't invalid, it just isn't authorized here.
    if (decoded.token_type !== 'platform_admin') {
        return res.status(403).json({ error: 'This route requires Platform Super Admin access' });
    }

    req.platformAdmin = decoded;
    next();
};
