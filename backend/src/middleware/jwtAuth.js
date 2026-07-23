const jwt = require('jsonwebtoken');
require('dotenv').config();

// Protects admin-panel API routes. Expects "Authorization: Bearer <token>"
// issued by POST /api/admin/login. Attaches the decoded payload
// ({ id, hospital_id, email, name }) to req.admin for handlers to scope
// queries by hospital.
module.exports = function jwtAuth(req, res, next) {
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Platform-admin tokens (backend/src/middleware/platformJwtAuth.js) carry no
        // hospital_id and must never be usable against hospital-scoped
        // routes — reject here rather than letting `req.admin.hospital_id`
        // come through as undefined. Tokens issued before this claim existed
        // have no token_type at all and still pass (no forced logout).
        if (decoded.token_type === 'platform_admin') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        req.admin = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};
