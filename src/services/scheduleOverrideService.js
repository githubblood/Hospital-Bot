const db = require('../config/db');
const { formatDate, cleanDoctorName } = require('../rule_engine/messages');

// DATE columns come back from mysql2 as JS Date objects (local midnight), not
// strings — normalize to 'YYYY-MM-DD' via the same local-Y/M/D-safe
// formatDate() used everywhere else in this codebase (a naive
// toISOString()/string coercion shifts a day in IST). Needed both for JSON
// responses and for shiftIsClosedByOverrides' string comparisons below.
function normalizeOverride(row) {
    if (!row) return row;
    return { ...row, start_date: formatDate(row.start_date), end_date: row.end_date ? formatDate(row.end_date) : null };
}

const SCOPES = ['Morning', 'Afternoon', 'Evening', 'Hospital'];
const REASONS = ['Doctor Emergency', 'Hospital Emergency', 'Public Holiday', 'Maintenance', 'Power Failure', 'Other'];

// Deliberately has no dependency on rescheduleService/waitlistService — this
// service only owns the schedule_overrides row and the enforcement read
// (isClosed), both pure data concerns. Rescheduling affected appointments
// after createOverride, and retrying the waiting list after liftOverride,
// are orchestrated one level up by scheduleController: rescheduleService
// already depends on bookingService, which depends back on this service's
// isClosed/listActiveOverrides for enforcement — folding the reschedule call
// in here too would make that a require() cycle.

// Future appointments in `scope` (or every shift, if scope === 'Hospital')
// that are still active — the set an override is about to strand.
async function findAffectedAppointments(hospitalId, scope) {
    const [rows] = await db.query(
        `SELECT a.id, a.patient_id, a.doctor_id, a.appointment_date, a.shift, a.expected_time, a.token_number,
                p.name AS patient_name, p.phone_number, doc.name AS doctor_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         WHERE p.hospital_id = ? AND a.appointment_date >= CURDATE()
           AND a.status IN ('Confirmed', 'Pending', 'Pending_Payment')
           AND (? = 'Hospital' OR a.shift = ?)
         ORDER BY a.appointment_date, a.expected_time`,
        [hospitalId, scope, scope]
    );
    // appointment_date normalized to 'YYYY-MM-DD' here (not left as the raw
    // Date object mysql2 returns) since these rows get passed straight into
    // rescheduleService's waitlist() INSERT and back out to the admin UI —
    // same convention as appointmentAdminService.listAppointments.
    return rows.map(r => ({ ...r, appointment_date: formatDate(r.appointment_date), doctor_name: cleanDoctorName(r.doctor_name) }));
}

async function createOverride(hospitalId, admin, { scope, reason, note }) {
    if (!SCOPES.includes(scope)) return { error: `Invalid scope "${scope}".` };
    if (!REASONS.includes(reason)) return { error: `Invalid reason "${reason}".` };

    const affected = await findAffectedAppointments(hospitalId, scope);

    const [result] = await db.query(
        `INSERT INTO schedule_overrides (hospital_id, scope, reason, note, start_date, created_by)
         VALUES (?, ?, ?, ?, CURDATE(), ?)`,
        [hospitalId, scope, reason, note || null, admin.id]
    );

    const [rows] = await db.query('SELECT * FROM schedule_overrides WHERE id = ?', [result.insertId]);
    return { override: normalizeOverride(rows[0]), affected };
}

async function listActiveOverrides(hospitalId) {
    const [rows] = await db.query(
        `SELECT o.*, a.name AS created_by_name
         FROM schedule_overrides o
         JOIN admin_users a ON a.id = o.created_by
         WHERE o.hospital_id = ? AND o.status = 'Active'
         ORDER BY o.created_at DESC`,
        [hospitalId]
    );
    return rows.map(normalizeOverride);
}

async function liftOverride(hospitalId, overrideId, admin) {
    const [result] = await db.query(
        `UPDATE schedule_overrides SET status = 'Lifted', lifted_by = ?, lifted_at = NOW()
         WHERE id = ? AND hospital_id = ? AND status = 'Active'`,
        [admin.id, overrideId, hospitalId]
    );
    if (result.affectedRows === 0) return { error: 'NOT_FOUND' };
    const [rows] = await db.query('SELECT * FROM schedule_overrides WHERE id = ?', [overrideId]);
    return { override: normalizeOverride(rows[0]) };
}

// The booking-engine enforcement read — a closed shift/hospital is genuinely
// unbookable, checked from bookingService.createAppointment and
// capacityController.validateShiftCapacity (single date+shift, cheap direct
// query — no batching needed for one lookup).
async function isClosed({ hospitalId, dateStr, shift }) {
    const [rows] = await db.query(
        `SELECT 1 FROM schedule_overrides
         WHERE hospital_id = ? AND status = 'Active'
           AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
           AND (scope = 'Hospital' OR scope = ?)
         LIMIT 1`,
        [hospitalId, dateStr, dateStr, shift]
    );
    return rows.length > 0;
}

// Pure, sync in-memory equivalent of isClosed, for callers scanning a whole
// date×shift grid (bookingService.getAvailability/getShiftsWithCapacity/
// getNextAvailable) — loads listActiveOverrides ONCE per call instead of
// hitting the DB per date/shift combination.
function shiftIsClosedByOverrides(overrides, dateStr, shift) {
    return overrides.some(o =>
        o.start_date <= dateStr &&
        (!o.end_date || o.end_date >= dateStr) &&
        (o.scope === 'Hospital' || o.scope === shift)
    );
}

module.exports = {
    SCOPES, REASONS,
    findAffectedAppointments, createOverride, listActiveOverrides, liftOverride,
    isClosed, shiftIsClosedByOverrides
};
