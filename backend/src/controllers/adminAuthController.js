const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const whatsappService = require('../services/whatsappService');
const { bi } = require('../webhook/messages');
const hospitalRegistrationService = require('../services/hospitalRegistrationService');
// Write-only dependency (Stage 4B): logs a HospitalAdminLogin entry into the
// platform's own activity feed. Never reads anything platform-scoped back
// into this hospital-admin flow, so this doesn't expose any cross-tenant
// data here — it only lets the platform side observe that a login happened.
const platformAdminService = require('../services/platformAdminService');
require('dotenv').config();

const RESET_CODE_TTL_MS = 10 * 60 * 1000;
const RESET_LOCKOUT_THRESHOLD = 5;
const RESET_LOCKOUT_MS = 15 * 60 * 1000;

// Best-effort audit write — never allowed to break the actual reset flow it's
// observing (same fire-and-forget-but-caught posture this project already
// uses for non-critical side effects like WhatsApp sends).
async function logResetAudit(adminUserId, email, req, action) {
    try {
        await db.query(
            'INSERT INTO password_reset_audit (admin_user_id, email_attempted, ip_address, action) VALUES (?, ?, ?, ?)',
            [adminUserId || null, email, req.ip || null, action]
        );
    } catch (err) {
        console.error('Failed to write password_reset_audit entry:', err);
    }
}

exports.login = async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
    }

    const [rows] = await db.query(
        `SELECT au.id, au.hospital_id, au.email, au.password_hash, au.name, au.role, h.name AS hospital_name, h.status AS hospital_status
         FROM admin_users au JOIN hospitals h ON h.id = au.hospital_id
         WHERE au.email = ?`,
        [email]
    );
    const admin = rows[0];

    // Same generic error whether the email doesn't exist or the password is
    // wrong, so a login attempt can't be used to enumerate valid accounts.
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Checked only AFTER password verification — a suspended hospital's
    // status shouldn't be discoverable by someone who doesn't even hold
    // valid credentials for it (same anti-enumeration reasoning as above).
    if (admin.hospital_status === 'Suspended') {
        return res.status(403).json({ error: 'This hospital account has been suspended. Please contact support.' });
    }

    // A random id minted at login, carried in the JWT purely for audit-trail
    // correlation (Stage 4B) — this app's tokens are still fully stateless,
    // there's no server-side session store behind this; it's just a stable
    // value every audit entry from this login can be tagged with.
    const sessionId = crypto.randomUUID();
    const payload = {
        id: admin.id, hospital_id: admin.hospital_id, email: admin.email, name: admin.name, role: admin.role,
        token_type: 'hospital_admin', session_id: sessionId
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

    // Best-effort, fire-and-forget — never allowed to block or fail a real
    // login (same posture as logResetAudit below).
    platformAdminService.recordAudit({
        actorType: 'HospitalAdmin', hospitalAdminId: admin.id, actorName: admin.name,
        actionType: 'HospitalAdminLogin', hospitalId: admin.hospital_id, hospitalName: admin.hospital_name,
        ipAddress: req.ip, userAgent: req.get('user-agent'), sessionId
    }).catch(err => console.error('Failed to write HospitalAdminLogin audit entry:', err));

    res.json({ token, admin: { ...payload, hospital_name: admin.hospital_name } });
};

// JWTs are stateless (no server-side session to invalidate) — logout is the
// client discarding its stored token. This endpoint exists so the frontend
// has a symmetric call to make, and as the natural place to add a token
// blocklist later if that's ever needed.
exports.logout = async (req, res) => {
    res.json({ success: true });
};

// Forgot Password — delivers a 6-digit OTP over WhatsApp (the only messaging
// channel this project has; no email/SMTP setup exists). Always returns the
// same generic response regardless of whether the email/phone are on file,
// for the same anti-enumeration reason as login's shared error message.
exports.forgotPassword = async (req, res) => {
    const { email } = req.body || {};
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    const [rows] = await db.query(
        `SELECT au.id, au.phone_number, h.whatsapp_business_phone_id, h.whatsapp_access_token
         FROM admin_users au JOIN hospitals h ON h.id = au.hospital_id
         WHERE au.email = ?`,
        [email]
    );
    const admin = rows[0];

    if (admin && admin.phone_number) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS);
        // Deliberately does NOT touch reset_failed_attempts/reset_locked_until —
        // an account mid-lockout must stay locked even if a fresh OTP is
        // requested, otherwise lockout could be trivially bypassed by just
        // calling forgot-password again. Only a successful reset clears it.
        await db.query('UPDATE admin_users SET reset_code = ?, reset_code_expires_at = ? WHERE id = ?', [code, expiresAt, admin.id]);

        await whatsappService.sendText(
            { whatsapp_business_phone_id: admin.whatsapp_business_phone_id, whatsapp_access_token: admin.whatsapp_access_token },
            admin.phone_number,
            bi(
                `🔐 Your admin panel password reset code is: *${code}*\nThis code expires in 10 minutes. If you didn't request this, you can ignore this message.`,
                `🔐 आपका एडमिन पैनल पासवर्ड रीसेट कोड है: *${code}*\nयह कोड 10 मिनट में समाप्त हो जाएगा। अगर आपने यह अनुरोध नहीं किया, तो इसे नज़रअंदाज़ करें।`
            )
        );
        await logResetAudit(admin.id, email, req, 'OTP_REQUESTED');
    }

    res.json({ success: true, message: 'If that email has a phone number on file, a reset code has been sent via WhatsApp.' });
};

// Hospital self-registration — multipart/form-data (uploadLogo middleware
// parses the "logo" file into req.file and every other field into req.body
// as plain strings). Public route, no auth required, since the whole point
// is to create the first account for a hospital that has none yet.
exports.registerHospital = async (req, res) => {
    const logoPath = req.file ? `uploads/logos/${req.file.filename}` : null;

    const result = await hospitalRegistrationService.registerHospital(req.body || {}, logoPath);

    if (result.error) {
        // Don't leave an orphaned upload on disk for a registration that
        // never became a hospital (bad email, weak password, etc.).
        if (req.file) {
            fs.unlink(req.file.path, () => {});
        }
        return res.status(400).json({ error: result.error });
    }

    res.status(201).json({
        success: true,
        message: 'Hospital account created successfully.',
        hospitalId: result.hospitalId,
        hospitalName: result.hospitalName
    });
};

exports.resetPassword = async (req, res) => {
    const { email, code, newPassword } = req.body || {};
    if (!email || !code || !newPassword) {
        return res.status(400).json({ error: 'Email, code, and new password are all required' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const [rows] = await db.query(
        'SELECT id, reset_code, reset_code_expires_at, reset_failed_attempts, reset_locked_until FROM admin_users WHERE email = ?',
        [email]
    );
    const admin = rows[0];

    // Lockout is checked before the code is even compared, and survives a
    // fresh OTP request (forgotPassword never clears it) — only a successful
    // reset below clears it, so a locked-out account can't be brute-forced
    // faster by repeatedly requesting new codes.
    if (admin && admin.reset_locked_until && new Date(admin.reset_locked_until) > new Date()) {
        await logResetAudit(admin.id, email, req, 'LOCKED_OUT');
        return res.status(429).json({ error: 'Too many failed attempts. Please try again in a few minutes.' });
    }

    const isValid = admin && admin.reset_code === code
        && admin.reset_code_expires_at && new Date(admin.reset_code_expires_at) > new Date();

    if (!isValid) {
        // Nothing to count/lock for an email that doesn't exist — same
        // generic error either way, so this can't be used to enumerate
        // accounts.
        if (admin) {
            const attempts = admin.reset_failed_attempts + 1;
            const lockingOut = attempts >= RESET_LOCKOUT_THRESHOLD;
            await db.query(
                'UPDATE admin_users SET reset_failed_attempts = ?, reset_locked_until = ? WHERE id = ?',
                [attempts, lockingOut ? new Date(Date.now() + RESET_LOCKOUT_MS) : null, admin.id]
            );
            await logResetAudit(admin.id, email, req, 'RESET_FAILED');
        }
        return res.status(400).json({ error: 'Invalid or expired reset code' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.query(
        `UPDATE admin_users
         SET password_hash = ?, reset_code = NULL, reset_code_expires_at = NULL,
             reset_failed_attempts = 0, reset_locked_until = NULL
         WHERE id = ?`,
        [hash, admin.id]
    );
    await logResetAudit(admin.id, email, req, 'RESET_SUCCESS');

    res.json({ success: true });
};
