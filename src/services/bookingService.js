const db = require('../config/db');
const catalogService = require('./catalogService');
const scheduleService = require('./scheduleService');

const DUPLICATE_KEY_ERRNO = 'ER_DUP_ENTRY';
const DEADLOCK_ERRNO = 'ER_LOCK_DEADLOCK';
const MAX_TOKEN_RETRIES = 3;

class SlotFullError extends Error {}

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
async function createAppointment({ patientId, doctorId, date, shift, hospitalConfig }) {
    const doctor = await catalogService.getDoctorById(doctorId);
    if (!doctor || !scheduleService.isDoctorAvailable(doctor, date, shift)) {
        throw new SlotFullError('Doctor unavailable for the requested date/shift');
    }

    const shiftWindow = scheduleService.getShiftWindow(doctor, date, shift);
    const { status, payment_status } = resolveInitialStatus(hospitalConfig);

    for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('SELECT id FROM doctors WHERE id = ? FOR UPDATE', [doctorId]);

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

// For each scheduled date in the window, remaining capacity per shift and in
// total. Dates the doctor doesn't work / is on leave are already excluded by
// scheduleService.getAvailableDates.
async function getAvailability(doctor, daysAhead = 7) {
    const dates = scheduleService.getAvailableDates(doctor, daysAhead);
    const counts = await getBookedCounts(doctor.id, dates.map(d => d.date));
    return dates.map(({ date, weekday }) => {
        const shifts = scheduleService.getAvailableShifts(doctor, date).map(shift => {
            const win = scheduleService.getShiftWindow(doctor, date, shift);
            const booked = counts[date]?.[shift] || 0;
            return { shift, max: win.max_tokens, booked, remaining: Math.max(0, win.max_tokens - booked) };
        });
        const totalRemaining = shifts.reduce((sum, s) => sum + s.remaining, 0);
        return { date, weekday, shifts, totalRemaining };
    });
}

// Remaining capacity for each shift on a single date.
async function getShiftsWithCapacity(doctor, date) {
    const counts = await getBookedCounts(doctor.id, [date]);
    return scheduleService.getAvailableShifts(doctor, date).map(shift => {
        const win = scheduleService.getShiftWindow(doctor, date, shift);
        const booked = counts[date]?.[shift] || 0;
        return { shift, max: win.max_tokens, booked, remaining: Math.max(0, win.max_tokens - booked) };
    });
}

// First date+shift (searching further ahead than the booking window) that
// still has at least one free token — used to gracefully redirect a patient
// when the slot they picked just filled up.
async function getNextAvailable(doctor, daysAhead = 14) {
    const avail = await getAvailability(doctor, daysAhead);
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

async function cancelAppointment(appointmentId, patientId, reason = null) {
    const [result] = await db.query(
        `UPDATE appointments SET status = 'Cancelled', cancelled_at = NOW(), cancel_reason = ?
         WHERE id = ? AND patient_id = ? AND status != 'Cancelled'`,
        [reason, appointmentId, patientId]
    );
    return result.affectedRows > 0;
}

// Links the old (rescheduled-away) row to the new row it was replaced by.
// A reschedule always creates a fresh row via createAppointment rather than
// mutating the original, so the old token/date/time stay in the record as a
// true history — see schema.sql's comment on rescheduled_from/rescheduled_to.
async function linkReschedule(oldAppointmentId, newAppointmentId) {
    await db.query(`UPDATE appointments SET status = 'Rescheduled', rescheduled_to = ? WHERE id = ?`, [newAppointmentId, oldAppointmentId]);
    await db.query(`UPDATE appointments SET rescheduled_from = ? WHERE id = ?`, [oldAppointmentId, newAppointmentId]);
}

module.exports = {
    createAppointment,
    getUpcomingAppointments,
    cancelAppointment,
    linkReschedule,
    getAvailability,
    getShiftsWithCapacity,
    getNextAvailable,
    SlotFullError
};
