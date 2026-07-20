const db = require('../config/db');
const catalogService = require('../services/catalogService');
const scheduleService = require('../services/scheduleService');

// Distinct failure reasons so a caller can message the patient precisely
// (on leave vs. not scheduled that day vs. genuinely fully booked) instead of
// a single generic "unavailable".
const REASON = {
    NOT_FOUND: 'NOT_FOUND',
    ON_LEAVE: 'ON_LEAVE',
    NOT_SCHEDULED: 'NOT_SCHEDULED',
    FULL: 'FULL'
};

// Pure validation — no session or messaging side effects — so it's reusable
// anywhere a single shift needs checking. Capacity (max_tokens) comes from
// the doctor's own schedule_json for that weekday/shift, not a flat
// doctors.max_tokens_per_shift column: this schema allows different capacity
// per day (see bookingService.createAppointment, which allocates tokens
// against that same per-shift window).
//
// A caller reacting to `available: false` should route the session back to
// STATES.SELECT_DATE (re-show date/shift options) rather than treat this as
// an unexpected error — the requested shift simply isn't bookable right now.
async function validateShiftCapacity(doctorId, requestedDate, requestedShift) {
    const doctor = await catalogService.getDoctorById(doctorId);
    if (!doctor) {
        return { available: false, reason: REASON.NOT_FOUND, remaining: 0 };
    }
    if (doctor.is_on_leave) {
        return { available: false, reason: REASON.ON_LEAVE, remaining: 0 };
    }

    const shiftWindow = scheduleService.getShiftWindow(doctor, requestedDate, requestedShift);
    if (!shiftWindow) {
        return { available: false, reason: REASON.NOT_SCHEDULED, remaining: 0 };
    }

    const [[{ cnt }]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM appointments
         WHERE doctor_id = ? AND appointment_date = ? AND shift = ?
               AND status IN ('Confirmed', 'Pending_Payment')`,
        [doctorId, requestedDate, requestedShift]
    );

    if (cnt >= shiftWindow.max_tokens) {
        return { available: false, reason: REASON.FULL, remaining: 0 };
    }

    return { available: true, reason: null, remaining: shiftWindow.max_tokens - cnt };
}

module.exports = { validateShiftCapacity, REASON };
