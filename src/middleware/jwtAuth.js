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
        req.admin = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};
