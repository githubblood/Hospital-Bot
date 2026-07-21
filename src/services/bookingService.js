const db = require('../config/db');
const catalogService = require('./catalogService');
const scheduleService = require('./scheduleService');
const scheduleOverrideService = require('./scheduleOverrideService');
const appointmentStateMachine = require('./appointmentStateMachine');

const DUPLICATE_KEY_ERRNO = 'ER_DUP_ENTRY';
const DEADLOCK_ERRNO = 'ER_LOCK_DEADLOCK';
const MAX_TOKEN_RETRIES = 3;

class SlotFullError extends Error {}
// Both subclass SlotFullError so every existing `catch (err) { if (err
// instanceof SlotFullError) ... }` call site (confirmBooking.js, reschedule.js,
// rescheduleService.js, adminAppointmentsController.js) keeps working
// unchanged and safely treats these as "can't book, redirect" without any
// code changes — while a caller that wants the specific reason can still
// check `instanceof PastDateError` / `instanceof DuplicateBookingError`.
class PastDateError extends SlotFullError {}
class DuplicateBookingError extends SlotFullError {}
// Same subclass-of-SlotFullError trick, so every existing catch site degrades
// safely by default; callers that want the specific suspended-hospital
// message check `instanceof HospitalSuspendedError` (see rescheduleService,
// receptionAdminService).
class HospitalSuspendedError extends SlotFullError {}

function resolveInitialStatus(hospitalConfig) {
    if (hospitalConfig.payment_required) {
        return { status: 'Pending_Payment', payment_status: 'Unpaid' };
    }
    if (hospitalConfig.approval_required) {
        return { status: 'Pending', payment_status: 'Unpaid' };
    }
    return { status: 'Confirmed', payment_status: 'Unpaid' };
}

// Allocates the next token for doctor/date/shift and inserts the appointment,
// all inside one transaction. `SELECT ... FOR UPDATE` on a MAX() aggregate
// over an *empty* result set locks nothing in MySQL/InnoDB — the classic gap
// in this pattern — so the doctor row is locked first instead; it always
// exists, which is what actually serializes concurrent bookings for the same
// doctor (including the very first token for a slot that has no rows yet).
// token_number = MAX(token_number) + 1 over ALL appointments for that
// doctor/date/shift, cancelled included, so a cancelled token is never
// reissued — the token space only ever grows.
async function createAppointment({ patientId, doctorId, date, shift, hospitalConfig, adminId = null }) {
    // Never enforced before Reception's free-form date picker existed — the
    // WhatsApp bot only ever offers dates from getAvailableDates/getAvailability,
    // which iterate forward from today, so it structurally never sent a past
    // date; that made this a real but latent gap, not a rule either caller
    // actually relied on breaking. Added here (the one function both the bot
    // and Reception funnel through) rather than in Reception's own code, so
    // it's genuinely shared — not a second, Reception-only copy of the rule.
    // The comparison itself runs in SQL, not JS — mysql2 returns CURDATE()
    // as a JS Date object, and `date < thatObject` silently coerces through
    // ToPrimitive/ToNumber to NaN (always false), which would make this
    // guard a no-op for every input. Doing `? < CURDATE()` server-side avoids
    // that trap entirely and matches this project's established "let SQL own
    // date truth" rule (the same IST/timezone bug class hit before).
    const [[{ isPast }]] = await db.query('SELECT (? < CURDATE()) AS isPast', [date]);
    if (isPast) {
        throw new PastDateError('Cannot book an appointment for a past date');
    }

    // Single choke point (Stage 3.5): every caller — WhatsApp bot, Reception,
    // manual booking, reschedule (creates a fresh row, see rescheduleService/
    // waitlistService) — funnels through here, so this is the one place a
    // suspended hospital's booking capability needs to be cut off for it to
    // be cut off everywhere, regardless of entry point. hospitalConfig is
    // always a full `SELECT * FROM hospitals` row at every real call site
    // (confirmBooking.js, reschedule.js, receptionAdminService, rescheduleService),
    // so `.status` is present whenever hospitalConfig itself is.
    if (hospitalConfig && hospitalConfig.status === 'Suspended') {
        throw new HospitalSuspendedError('This hospital account has been suspended');
    }

    const doctor = await catalogService.getDoctorById(doctorId);
    if (!doctor || !scheduleService.isDoctorAvailable(doctor, date, shift)) {
        throw new SlotFullError('Doctor unavailable for the requested date/shift');
    }
    if (hospitalConfig && await scheduleOverrideService.isClosed({ hospitalId: hospitalConfig.id, dateStr: date, shift })) {
        throw new SlotFullError('This shift is currently closed');
    }

    const shiftWindow = scheduleService.getShiftWindow(doctor, date, shift);
    const { status, payment_status } = resolveInitialStatus(hospitalConfig);

    for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('SELECT id FROM doctors WHERE id = ? FOR UPDATE', [doctorId]);

            // Same reasoning as the past-date guard: no existing caller (bot
            // or admin) ever checked for this, so it's a genuine,
            // previously-unguarded gap closed once, here, for every caller.
            // "Duplicate" means the same patient already has another live
            // (non-terminal) appointment with this exact doctor on this
            // exact date — same doctor, same day, regardless of shift.
            // Deliberately run AFTER the FOR UPDATE lock above, not before
            // it: a stress test during this stabilization pass proved that
            // running this same SELECT on the plain pool *before* the lock
            // let two concurrent requests for the identical patient/doctor/
            // date/shift both pass the check before either committed,
            // creating two real appointments (different tokens, so the
            // token-uniqueness constraint never caught it either). The
            // doctor-row lock already serializes every booking for this
            // doctor regardless of date/shift/patient, so checking here
            // makes the duplicate check atomic with the insert for free.
            const [dupRows] = await conn.query(
                `SELECT id FROM appointments
                 WHERE patient_id = ? AND doctor_id = ? AND appointment_date = ?
                       AND status NOT IN ('Cancelled', 'Rescheduled', 'Completed', 'No Show')`,
                [patientId, doctorId, date]
            );
            if (dupRows.length > 0) {
                throw new DuplicateBookingError('This patient already has an active appointment with this doctor on this date');
            }

            const [maxRows] = await conn.query(
                `SELECT MAX(token_number) AS maxToken FROM appointments
                 WHERE doctor_id = ? AND appointment_date = ? AND shift = ?`,
                [doctorId, date, shift]
            );
            const tokenNumber = (maxRows[0].maxToken || 0) + 1;

            if (tokenNumber > shiftWindow.max_tokens) {
                throw new SlotFullError('No tokens left for this slot');
            }

            const expectedTime = scheduleService.computeExpectedTime(shiftWindow, tokenNumber);

            const [result] = await conn.query(
                `INSERT INTO appointments
                 (patient_id, doctor_id, appointment_date, shift, token_number, expected_time, status, payment_status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [patientId, doctorId, date, shift, tokenNumber, expectedTime, status, payment_status]
            );

            await conn.commit();
            // The one creation-time audit entry, for every appointment
            // regardless of origin (WhatsApp bot or Reception) — this is the
            // single INSERT site, so this is the single place that logs it.
            // Runs after commit (on the pool, not `conn`) since the row must
            // already durably exist before appointment_status_history's FK
            // can reference it.
            await appointmentStateMachine.recordCreation(result.insertId, status, adminId);
            return {
                id: result.insertId,
                tokenNumber,
                expectedTime,
                status,
                payment_status,
                consultation_fee: doctor.consultation_fee
            };
        } catch (err) {
            await conn.rollback();
            // uniq_doctor_date_shift_token (schema.sql) is the last-resort backstop
            // if two transactions ever did interleave; a deadlock can happen if two
            // doctors' locks are acquired in different orders elsewhere. Both are
            // transient — safe to recompute the token and retry.
            const retryable = err.code === DUPLICATE_KEY_ERRNO || err.code === DEADLOCK_ERRNO;
            if (retryable && attempt < MAX_TOKEN_RETRIES - 1) continue;
            throw err;
        } finally {
            conn.release();
        }
    }
    throw new SlotFullError('Could not allocate a token, please try again');
}

// --- Scenario 9: capacity awareness -------------------------------------
// Booked (non-cancelled) token counts per date+shift for a doctor, keyed as
// map[date][shift] = count. DATE_FORMAT in SQL avoids the JS Date timezone
// shift that would otherwise misattribute an IST date to the previous day.
async function getBookedCounts(doctorId, dates) {
    if (!dates || dates.length === 0) return {};
    const [rows] = await db.query(
        `SELECT DATE_FORMAT(appointment_date, '%Y-%m-%d') AS d, shift, COUNT(*) AS cnt
         FROM appointments
         WHERE doctor_id = ? AND status != 'Cancelled' AND appointment_date IN (?)
         GROUP BY d, shift`,
        [doctorId, dates]
    );
    const map = {};
    for (const r of rows) {
        map[r.d] = map[r.d] || {};
        map[r.d][r.shift] = r.cnt;
    }
    return map;
}

// `hospitalId` is optional and additive (omitted callers behave exactly as
// before — internal diagnostics/stats that don't drive real bookings). When
// provided, active overrides are loaded ONCE per call and every date/shift
// combo is filtered against them in-memory (scheduleOverrideService.
// shiftIsClosedByOverrides) rather than one DB round-trip per combo, since
// this can scan a 7-21 day x 3-shift grid.
async function loadOverridesIfNeeded(hospitalId) {
    return hospitalId ? scheduleOverrideService.listActiveOverrides(hospitalId) : [];
}

// For each scheduled date in the window, remaining capacity per shift and in
// total. Dates the doctor doesn't work / is on leave are already excluded by
// scheduleService.getAvailableDates.
async function getAvailability(doctor, daysAhead = 7, hospitalId = null) {
    const dates = scheduleService.getAvailableDates(doctor, daysAhead);
    const counts = await getBookedCounts(doctor.id, dates.map(d => d.date));
    const overrides = await loadOverridesIfNeeded(hospitalId);
    return dates.map(({ date, weekday }) => {
        const shifts = scheduleService.getAvailableShifts(doctor, date)
            .filter(shift => !scheduleOverrideService.shiftIsClosedByOverrides(overrides, date, shift))
            .map(shift => {
                const win = scheduleService.getShiftWindow(doctor, date, shift);
                const booked = counts[date]?.[shift] || 0;
                return { shift, max: win.max_tokens, booked, remaining: Math.max(0, win.max_tokens - booked) };
            });
        const totalRemaining = shifts.reduce((sum, s) => sum + s.remaining, 0);
        return { date, weekday, shifts, totalRemaining };
    });
}

// Remaining capacity for each shift on a single date.
async function getShiftsWithCapacity(doctor, date, hospitalId = null) {
    const counts = await getBookedCounts(doctor.id, [date]);
    const overrides = await loadOverridesIfNeeded(hospitalId);
    return scheduleService.getAvailableShifts(doctor, date)
        .filter(shift => !scheduleOverrideService.shiftIsClosedByOverrides(overrides, date, shift))
        .map(shift => {
            const win = scheduleService.getShiftWindow(doctor, date, shift);
            const booked = counts[date]?.[shift] || 0;
            return { shift, max: win.max_tokens, booked, remaining: Math.max(0, win.max_tokens - booked) };
        });
}

// First date+shift (searching further ahead than the booking window) that
// still has at least one free token — used to gracefully redirect a patient
// when the slot they picked just filled up.
async function getNextAvailable(doctor, daysAhead = 14, hospitalId = null) {
    const avail = await getAvailability(doctor, daysAhead, hospitalId);
    for (const day of avail) {
        const openShift = day.shifts.find(s => s.remaining > 0);
        if (openShift) {
            return { date: day.date, weekday: day.weekday, shift: openShift.shift, remaining: openShift.remaining };
        }
    }
    return null;
}
// ------------------------------------------------------------------------

async function getUpcomingAppointments(patientId) {
    const [rows] = await db.query(
        `SELECT a.*, d.name AS doctor_name, dep.name_en AS department_name, dep.name_hi AS department_name_hi
         FROM appointments a
         JOIN doctors d ON d.id = a.doctor_id
         JOIN departments dep ON dep.id = d.department_id
         WHERE a.patient_id = ? AND a.appointment_date >= CURDATE() AND a.status NOT IN ('Cancelled', 'Rescheduled')
         ORDER BY a.appointment_date, a.expected_time`,
        [patientId]
    );
    return rows;
}

// Patient's own self-service cancel (WhatsApp "My Appointments"), scoped by
// patient_id — a genuinely different guard shape than an admin action (no
// hospital/role to check, just "is this really your own appointment"), so
// that ownership check stays here rather than in the shared state machine.
// The actual status write + audit entry goes through it though, same as
// every other cancel path — which also means a Completed/Rescheduled/'No
// Show' appointment can no longer be "cancelled" this way, a real gap the
// old `status != 'Cancelled'` check didn't catch (it only blocked
// re-cancelling an already-cancelled row).
async function cancelAppointment(appointmentId, patientId, reason = null) {
    const [rows] = await db.query('SELECT id FROM appointments WHERE id = ? AND patient_id = ?', [appointmentId, patientId]);
    if (!rows[0]) return false;

    const result = await appointmentStateMachine.transitionStatus(appointmentId, 'Cancelled', {
        extraFields: { cancelled_at: new Date(), cancel_reason: reason }
    });
    return !result.error;
}

// Links the old (rescheduled-away) row to the new row it was replaced by.
// A reschedule always creates a fresh row via createAppointment rather than
// mutating the original, so the old token/date/time stay in the record as a
// true history — see schema.sql's comment on rescheduled_from/rescheduled_to.
// Only sets the new row's rescheduled_from if the old row's own transition
// actually succeeded — otherwise a rejected transition (e.g. the old row was
// somehow already terminal) would still leave the new row pointing back at
// an old row that was never itself marked Rescheduled, an inconsistent pair.
async function linkReschedule(oldAppointmentId, newAppointmentId, adminId = null) {
    const result = await appointmentStateMachine.transitionStatus(oldAppointmentId, 'Rescheduled', {
        adminId, extraFields: { rescheduled_to: newAppointmentId }
    });
    if (result.error) return result;

    await db.query('UPDATE appointments SET rescheduled_from = ? WHERE id = ?', [oldAppointmentId, newAppointmentId]);
    return result;
}

module.exports = {
    createAppointment,
    getUpcomingAppointments,
    cancelAppointment,
    linkReschedule,
    getAvailability,
    getShiftsWithCapacity,
    getNextAvailable,
    SlotFullError,
    PastDateError,
    DuplicateBookingError,
    HospitalSuspendedError
};
