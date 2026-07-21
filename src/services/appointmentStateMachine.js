// The single place every appointment status/checkin_status change goes
// through — built during the post-Reception stabilization pass after an
// audit found status writes scattered across appointmentAdminService,
// bookingService, queueAdminService, receptionAdminService, rescheduleService,
// and (worst) directly inside a controller (adminController.confirmPayment).
// Two responsibilities, always together: (1) reject a transition that isn't
// explicitly allowed from the row's CURRENT status, read fresh at write time
// (not trusted from an earlier SELECT, closing a race a caller could
// otherwise hit), and (2) write exactly one appointment_status_history row —
// callers never call that table directly.
const db = require('../config/db');
const appointmentHistoryService = require('./appointmentHistoryService');

// Derived from every real transition this codebase actually performs today
// (see the stabilization-pass audit) — not a speculative full state diagram.
// Terminal statuses map to an empty array: Cancelled/Completed/Rescheduled/
// 'No Show' never transition again.
const STATUS_TRANSITIONS = {
    Pending: ['Confirmed', 'Cancelled'],
    Pending_Payment: ['Confirmed', 'Cancelled'],
    Confirmed: ['Cancelled', 'Completed', 'Rescheduled', 'Waitlisted', 'No Show'],
    Waitlisted: ['Rescheduled', 'Cancelled'],
    Cancelled: [],
    Completed: [],
    Rescheduled: [],
    'No Show': []
};

// checkin_status is only meaningful while `status` is 'Confirmed' (see
// schema.sql's comment on the column) — transitionCheckin enforces that
// separately from this map, which only governs the Waiting -> Checked In ->
// In Consultation sequence itself. No reverse transition exists because no
// caller in this codebase currently performs one (an "undo check-in" was
// considered during Reception's design and deliberately not built).
const CHECKIN_TRANSITIONS = {
    Waiting: ['Checked In'],
    'Checked In': ['In Consultation'],
    'In Consultation': []
};

async function getCurrent(appointmentId) {
    const [rows] = await db.query('SELECT status, checkin_status FROM appointments WHERE id = ?', [appointmentId]);
    return rows[0] || null;
}

// extraFields: plain object of additional columns to set in the SAME
// UPDATE (e.g. { cancelled_at: new Date(), cancel_reason, cancelled_by }) —
// keeps every transition atomic (one statement) rather than a status write
// followed by a separate patch, which is exactly the "no partial writes"
// requirement for these call sites.
async function transitionStatus(appointmentId, toStatus, { adminId = null, extraFields = {} } = {}) {
    const current = await getCurrent(appointmentId);
    if (!current) return { error: 'NOT_FOUND' };

    const allowed = STATUS_TRANSITIONS[current.status] || [];
    if (!allowed.includes(toStatus)) {
        return { error: 'INVALID_TRANSITION', from: current.status, to: toStatus };
    }

    const extraKeys = Object.keys(extraFields);
    const setClause = ['status = ?', ...extraKeys.map(k => `${k} = ?`)].join(', ');
    const params = [toStatus, ...extraKeys.map(k => extraFields[k]), appointmentId];
    await db.query(`UPDATE appointments SET ${setClause} WHERE id = ?`, params);

    await appointmentHistoryService.record(appointmentId, current.status, toStatus, adminId);
    return { id: Number(appointmentId), status: toStatus, previousStatus: current.status };
}

async function transitionCheckin(appointmentId, toCheckinStatus, { adminId = null, extraFields = {} } = {}) {
    const current = await getCurrent(appointmentId);
    if (!current) return { error: 'NOT_FOUND' };
    if (current.status !== 'Confirmed') {
        return { error: 'INVALID_STATE', message: `Only a Confirmed appointment can change check-in state (currently ${current.status}).` };
    }

    const allowed = CHECKIN_TRANSITIONS[current.checkin_status] || [];
    if (!allowed.includes(toCheckinStatus)) {
        return { error: 'INVALID_TRANSITION', from: current.checkin_status, to: toCheckinStatus };
    }

    const extraKeys = Object.keys(extraFields);
    const setClause = ['checkin_status = ?', ...extraKeys.map(k => `${k} = ?`)].join(', ');
    const params = [toCheckinStatus, ...extraKeys.map(k => extraFields[k]), appointmentId];
    await db.query(`UPDATE appointments SET ${setClause} WHERE id = ?`, params);

    await appointmentHistoryService.record(appointmentId, current.checkin_status, toCheckinStatus, adminId);
    return { id: Number(appointmentId), checkin_status: toCheckinStatus };
}

// The one creation-time history entry — called from bookingService.createAppointment
// itself (the single INSERT site) so every appointment, WhatsApp- or
// Reception-created, gets exactly one "Created" entry with no caller having
// to remember to log it separately.
async function recordCreation(appointmentId, initialStatus, adminId = null) {
    await appointmentHistoryService.record(appointmentId, null, initialStatus, adminId);
}

module.exports = { transitionStatus, transitionCheckin, recordCreation, STATUS_TRANSITIONS, CHECKIN_TRANSITIONS };
