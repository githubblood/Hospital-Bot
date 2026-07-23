const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { isValidEmail, isValidPhone, isStrongEnoughPassword, cleanOptional, isNonEmpty } = require('../validators/validators');

// A brand-new self-registered hospital gets the simplest possible config —
// single-doctor-clinic mode (no branch/department picker, no approval/payment
// gate) — so the WhatsApp bot has the fewest menus to fall through while the
// hospital is still empty (zero doctors added yet). This mirrors the existing
// "same codebase serves a chain down to a single clinic" architecture
// (see hospitals.multi_branch/multi_dept/multi_doctor) rather than inventing
// new bot behavior — every one of these flags is already read by the rule
// engine today. whatsapp_business_phone_id/whatsapp_access_token are left
// NULL: the hospital exists, but the bot stays inert for it (no incoming
// webhook can match a NULL phone_id) until the admin configures WhatsApp via
// the existing Settings > WhatsApp Bot Configuration page.
const DEFAULT_HOSPITAL_FLAGS = {
    multi_branch: false, multi_dept: false, multi_doctor: false,
    walk_in_only: false, approval_required: false, payment_required: false,
    emergency_support: true
};

// Validates the full registration payload up front so the controller only
// ever has to translate one { field, error } result into a 400 — no
// scattered field checks in the controller itself.
function validateRegistration(body) {
    const required = [
        ['hospital_name', 'Hospital name'], ['hospital_email', 'Hospital email'],
        ['hospital_phone', 'Hospital phone number'], ['address', 'Address'],
        ['city', 'City'], ['state', 'State'], ['country', 'Country'], ['pincode', 'Pincode'],
        ['admin_name', 'Admin full name'], ['admin_email', 'Admin email'],
        ['admin_phone', 'Admin mobile number'], ['password', 'Password'], ['confirm_password', 'Confirm password']
    ];
    for (const [field, label] of required) {
        if (!isNonEmpty(body[field])) return { error: `${label} is required` };
    }
    if (!isValidEmail(body.hospital_email)) return { error: 'Hospital email is not a valid email address' };
    if (!isValidEmail(body.admin_email)) return { error: 'Admin email is not a valid email address' };
    if (!isValidPhone(body.hospital_phone)) return { error: 'Hospital phone number must be 10-15 digits' };
    if (!isValidPhone(body.admin_phone)) return { error: 'Admin mobile number must be 10-15 digits' };
    if (body.password !== body.confirm_password) return { error: 'Password and Confirm Password do not match' };
    if (!isStrongEnoughPassword(body.password)) {
        return { error: 'Password must be at least 8 characters and include at least 3 of: lowercase, uppercase, number, symbol' };
    }
    if (body.agree_terms !== 'true' && body.agree_terms !== true) {
        return { error: 'You must agree to the Terms & Conditions' };
    }
    return { error: null };
}

// logoPath: the relative (already-saved-to-disk) path from uploadLogo.js,
// e.g. "uploads/logos/171234-abc.png", or null if no logo was uploaded.
async function registerHospital(body, logoPath) {
    const validation = validateRegistration(body);
    if (validation.error) return { error: validation.error };

    const adminEmail = body.admin_email.trim().toLowerCase();

    // Friendly pre-check (fast path); the UNIQUE constraint on admin_users.email
    // is still the real guarantee against a race between two concurrent
    // signups with the same email — caught below via ER_DUP_ENTRY.
    const [existing] = await db.query('SELECT id FROM admin_users WHERE email = ?', [adminEmail]);
    if (existing[0]) return { error: 'An account with this admin email already exists' };

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [hospitalResult] = await conn.query(
            `INSERT INTO hospitals
                (name, email, phone, address, city, state, country, pincode, logo,
                 multi_branch, multi_dept, multi_doctor, walk_in_only, approval_required, payment_required, emergency_support)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                body.hospital_name.trim(), body.hospital_email.trim().toLowerCase(), body.hospital_phone.trim(),
                body.address.trim(), body.city.trim(), body.state.trim(), cleanOptional(body.country) || 'India', body.pincode.trim(),
                logoPath,
                DEFAULT_HOSPITAL_FLAGS.multi_branch, DEFAULT_HOSPITAL_FLAGS.multi_dept, DEFAULT_HOSPITAL_FLAGS.multi_doctor,
                DEFAULT_HOSPITAL_FLAGS.walk_in_only, DEFAULT_HOSPITAL_FLAGS.approval_required,
                DEFAULT_HOSPITAL_FLAGS.payment_required, DEFAULT_HOSPITAL_FLAGS.emergency_support
            ]
        );
        const hospitalId = hospitalResult.insertId;

        const passwordHash = await bcrypt.hash(body.password, 10);

        const [adminResult] = await conn.query(
            `INSERT INTO admin_users (hospital_id, email, password_hash, name, role, phone_number)
             VALUES (?, ?, ?, ?, 'Super Admin', ?)`,
            [hospitalId, adminEmail, passwordHash, body.admin_name.trim(), body.admin_phone.trim()]
        );

        await conn.commit();
        return { hospitalId, adminId: adminResult.insertId, hospitalName: body.hospital_name.trim() };
    } catch (err) {
        await conn.rollback();
        if (err.code === 'ER_DUP_ENTRY') {
            return { error: 'An account with this admin email already exists' };
        }
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = { registerHospital, validateRegistration };
