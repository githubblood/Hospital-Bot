const db = require('../config/db');

// Same pattern as scheduleAuditService — changed_by_name is a snapshot (not
// just the changed_by FK) so the timeline still reads correctly if that
// admin account is later renamed or deleted. changed_by/changed_by_name are
// both left NULL for a bot/patient-initiated transition (e.g. a WhatsApp
// self-cancel) — there's no admin to attribute it to.
async function record(appointmentId, fromStatus, toStatus, adminId) {
    let adminName = null;
    if (adminId) {
        const [rows] = await db.query('SELECT name FROM admin_users WHERE id = ?', [adminId]);
        adminName = rows[0] ? rows[0].name : null;
    }
    await db.query(
        'INSERT INTO appointment_status_history (appointment_id, from_status, to_status, changed_by, changed_by_name) VALUES (?, ?, ?, ?, ?)',
        [appointmentId, fromStatus, toStatus, adminId || null, adminName]
    );
}

async function listForAppointment(appointmentId) {
    const [rows] = await db.query(
        'SELECT id, from_status, to_status, changed_by_name, changed_at FROM appointment_status_history WHERE appointment_id = ? ORDER BY changed_at ASC',
        [appointmentId]
    );
    return rows;
}

module.exports = { record, listForAppointment };
