const bcrypt = require('bcryptjs');
const db = require('../config/db');

// 'logo' is deliberately NOT included here: this endpoint always writes every
// field in the list (nulling out anything the client omits — see
// updateProfile below), which matches settings.html's Hospital Info tab
// always submitting its full form. Logo is only set at registration time
// (hospitalRegistrationService.js, direct column write); wiring a re-upload
// through this generic replace-all endpoint would need its own multipart
// route (like registration has), not a place in this plain-JSON field list.
// Operating hours (morning/afternoon/evening) moved out of this list — they
// now have their own tab/endpoint (operatingHoursService.js), since saving
// them needs the affected-appointments preview/warning flow, not a blind
// blanket rewrite.
const PROFILE_FIELDS = ['name', 'icon', 'address', 'city', 'state', 'country', 'pincode',
    'phone', 'email', 'website', 'emergency_contact'];

// hospitals.* config flags read throughout the rule engine (hospital.multi_branch,
// etc.) — no caching layer sits in front of getHospitalConfig, so a save here
// takes effect on the very next incoming WhatsApp message.
const FEATURE_FIELDS = ['multi_branch', 'multi_dept', 'multi_doctor', 'walk_in_only',
    'approval_required', 'payment_required', 'emergency_support'];

async function getProfile(hospitalId) {
    const [rows] = await db.query(
        `SELECT ${PROFILE_FIELDS.join(', ')} FROM hospitals WHERE id = ?`, [hospitalId]
    );
    return rows[0] || null;
}

async function updateProfile(hospitalId, body) {
    const values = PROFILE_FIELDS.map(f => (body[f] === undefined || body[f] === '' ? null : body[f]));
    const setClause = PROFILE_FIELDS.map(f => `${f} = ?`).join(', ');
    await db.query(`UPDATE hospitals SET ${setClause} WHERE id = ?`, [...values, hospitalId]);
}

async function getFeatures(hospitalId) {
    const [rows] = await db.query(
        `SELECT ${FEATURE_FIELDS.join(', ')} FROM hospitals WHERE id = ?`, [hospitalId]
    );
    return rows[0] || null;
}

async function updateFeatures(hospitalId, body) {
    const values = FEATURE_FIELDS.map(f => !!body[f]);
    const setClause = FEATURE_FIELDS.map(f => `${f} = ?`).join(', ');
    await db.query(`UPDATE hospitals SET ${setClause} WHERE id = ?`, [...values, hospitalId]);
}

async function getAccount(adminId) {
    const [rows] = await db.query('SELECT name, email, role FROM admin_users WHERE id = ?', [adminId]);
    return rows[0] || null;
}

// Password change is optional — omit newPassword to just rename the admin.
// Renaming without a password check is safe: nothing sensitive is exposed by
// the name field itself, and the request already carries a valid JWT.
// role is intentionally not writable here — see the comment in
// settingsController.js's updateAccount.
async function updateAccount(adminId, { name, currentPassword, newPassword }) {
    if (newPassword) {
        const [rows] = await db.query('SELECT password_hash FROM admin_users WHERE id = ?', [adminId]);
        const admin = rows[0];
        if (!admin || !currentPassword || !(await bcrypt.compare(currentPassword, admin.password_hash))) {
            return { error: 'WRONG_PASSWORD' };
        }
        const hash = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE admin_users SET name = ?, password_hash = ? WHERE id = ?', [name, hash, adminId]);
    } else {
        await db.query('UPDATE admin_users SET name = ? WHERE id = ?', [name, adminId]);
    }
    return { success: true };
}

async function getWhatsAppConfig(hospitalId) {
    const [rows] = await db.query(
        'SELECT whatsapp_business_phone_id, whatsapp_access_token FROM hospitals WHERE id = ?', [hospitalId]
    );
    return rows[0] || null;
}

async function updateWhatsAppConfig(hospitalId, { whatsapp_business_phone_id, whatsapp_access_token }) {
    await db.query(
        'UPDATE hospitals SET whatsapp_business_phone_id = ?, whatsapp_access_token = ? WHERE id = ?',
        [whatsapp_business_phone_id, whatsapp_access_token, hospitalId]
    );
}

// Hits Meta's Graph API with the hospital's own stored credentials — a real
// connectivity check, not a decorative "always succeeds" button.
async function testWhatsAppConnection(hospitalId) {
    const axios = require('axios');
    const config = await getWhatsAppConfig(hospitalId);
    if (!config || !config.whatsapp_business_phone_id || !config.whatsapp_access_token) {
        return { success: false, message: 'WhatsApp config is not set yet' };
    }
    const version = process.env.META_GRAPH_API_VERSION || 'v20.0';
    try {
        const res = await axios.get(
            `https://graph.facebook.com/${version}/${config.whatsapp_business_phone_id}`,
            { headers: { Authorization: `Bearer ${config.whatsapp_access_token}` } }
        );
        return { success: true, displayPhoneNumber: res.data.display_phone_number };
    } catch (err) {
        return { success: false, message: err.response?.data?.error?.message || err.message };
    }
}

module.exports = {
    getProfile, updateProfile, getFeatures, updateFeatures,
    getAccount, updateAccount, getWhatsAppConfig, updateWhatsAppConfig, testWhatsAppConnection
};
