const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const platformAdminService = require('../services/platformAdminService');
require('dotenv').config();

// Mirrors adminAuthController.login's shape (same generic-error anti-
// enumeration reasoning, same JWT_EXPIRES_IN), but reads from platform_admins
// — a completely separate table with no hospital_id and no role column.
exports.login = async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
    }

    const [rows] = await db.query(
        'SELECT id, email, password_hash, name FROM platform_admins WHERE email = ?',
        [email]
    );
    const admin = rows[0];

    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Same audit-correlation id as the hospital-admin side (Stage 4B) —
    // see adminAuthController.login's own comment on this.
    const sessionId = crypto.randomUUID();
    const payload = { id: admin.id, email: admin.email, name: admin.name, token_type: 'platform_admin', session_id: sessionId };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

    platformAdminService.recordAudit({
        actorType: 'PlatformAdmin', platformAdminId: admin.id, actorName: admin.name,
        actionType: 'PlatformLogin', ipAddress: req.ip, userAgent: req.get('user-agent'), sessionId
    }).catch(err => console.error('Failed to write PlatformLogin audit entry:', err));

    res.json({ token, admin: payload });
};

// JWTs are stateless — same reasoning as adminAuthController.logout.
exports.logout = async (req, res) => {
    res.json({ success: true });
};
