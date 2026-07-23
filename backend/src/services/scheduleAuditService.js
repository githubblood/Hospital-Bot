const db = require('../config/db');

// Permanent record of every operating-hours save and emergency-override
// create/lift — distinct from adminActivityService's derived, read-time
// "Recent Activity" feed, which has no persistence and no notion of who
// changed what. See database/schema.sql's comment on schedule_audit_log.
async function record({
    hospitalId, adminId, adminName, changeType,
    previousHours = null, updatedHours = null, overrideId = null,
    affectedCount = 0, actionTaken
}) {
    await db.query(
        `INSERT INTO schedule_audit_log
            (hospital_id, admin_id, admin_name, change_type, previous_hours, updated_hours,
             override_id, affected_appointments_count, action_taken)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            hospitalId, adminId, adminName, changeType,
            previousHours ? JSON.stringify(previousHours) : null,
            updatedHours ? JSON.stringify(updatedHours) : null,
            overrideId, affectedCount, actionTaken
        ]
    );
}

async function list(hospitalId, { limit = 50, offset = 0 } = {}) {
    // LEFT JOIN (not INNER) so a row whose override was later deleted — the
    // FK is ON DELETE SET NULL, not CASCADE — still lists, just without
    // scope/reason; OperatingHours entries have no override_id at all and
    // are unaffected either way.
    const [rows] = await db.query(
        `SELECT l.*, o.scope AS override_scope, o.reason AS override_reason, o.note AS override_note
         FROM schedule_audit_log l
         LEFT JOIN schedule_overrides o ON o.id = l.override_id
         WHERE l.hospital_id = ? ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
        [hospitalId, Number(limit), Number(offset)]
    );
    // mysql2 returns JSON columns as raw strings here (not auto-parsed —
    // same as doctors.schedule_json elsewhere in this codebase), so these
    // need an explicit parse before the frontend can diff previous vs
    // updated hours.
    return rows.map(r => ({
        ...r,
        previous_hours: r.previous_hours ? JSON.parse(r.previous_hours) : null,
        updated_hours: r.updated_hours ? JSON.parse(r.updated_hours) : null
    }));
}

module.exports = { record, list };
