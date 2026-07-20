const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const whatsappService = require('../services/whatsappService');
const { bi } = require('../rule_engine/messages');
const hospitalRegistrationService = require('../services/hospitalRegistrationService');
require('dotenv').config();

const RESET_CODE_TTL_MS = 10 * 60 * 1000;

exports.login = async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
    }

    const [rows] = await db.query(
        `SELECT au.id, au.hospital_id, au.email, au.password_hash, au.name, au.role, h.name AS hospital_name
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

    const payload = { id: admin.id, hospital_id: admin.hospital_id, email: admin.email, name: admin.name, role: admin.role };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

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
        await db.query('UPDATE admin_users SET reset_code = ?, reset_code_expires_at = ? WHERE id = ?', [code, expiresAt, admin.id]);

        await whatsappService.sendText(
            { whatsapp_business_phone_id: admin.whatsapp_business_phone_id, whatsapp_access_token: admin.whatsapp_access_token },
            admin.phone_number,
            bi(
                `🔐 Your admin panel password reset code is: *${code}*\nThis code expires in 10 minutes. If you didn't request this, you can ignore this message.`,
                `🔐 आपका एडमिन पैनल पासवर्ड रीसेट कोड है: *${code}*\nयह कोड 10 मिनट में समाप्त हो जाएगा। अगर आपने यह अनुरोध नहीं किया, तो इसे नज़रअंदाज़ करें।`
            )
        );
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

    const [rows] = await db.query('SELECT id, reset_code, reset_code_expires_at FROM admin_users WHERE email = ?', [email]);
    const admin = rows[0];

    const isValid = admin && admin.reset_code === code
        && admin.reset_code_expires_at && new Date(admin.reset_code_expires_at) > new Date();

    if (!isValid) {
        return res.status(400).json({ error: 'Invalid or expired reset code' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE admin_users SET password_hash = ?, reset_code = NULL, reset_code_expires_at = NULL WHERE id = ?', [hash, admin.id]);

    res.json({ success: true });
};
