const db = require('../config/db');
const rescheduleService = require('./rescheduleService');
const bookingService = require('./bookingService');

// Re-runs the tier-1/tier-2 search (same doctor, then same department) for
// every still-waiting row — called synchronously right after an admin lifts
// an override (see scheduleController.liftOverride), since that's the only
// event that should free up capacity relevant to this feature (see the
// plan's "no polling background job" decision). A row that still finds
// nothing is left as-is, not re-inserted — retryWaitingList is idempotent to
// call repeatedly.
async function retryWaitingList(hospitalId) {
    const [rows] = await db.query(
        `SELECT w.*, a.patient_id, a.doctor_id, a.appointment_date, p.phone_number, doc.name AS doctor_name
         FROM waiting_list w
         JOIN patients p ON p.id = w.patient_id
         JOIN appointments a ON a.id = w.original_appointment_id
         JOIN doctors doc ON doc.id = w.doctor_id
         WHERE p.hospital_id = ? AND w.status = 'Waiting'
         ORDER BY w.created_at ASC`,
        [hospitalId]
    );

    // Parallelized (Stage 3.5 perf review — this was the single worst N+1 in
    // the app: sequential search+book+notify per waiting patient, each a
    // multi-query round trip). Independent-doctor rows now genuinely overlap;
    // same-doctor rows still serialize safely underneath via
    // bookingService.createAppointment's own per-doctor `FOR UPDATE` lock —
    // parallelizing doesn't change who wins a contended slot, it just lets
    // everyone else stop waiting on them. Promise.all (not allSettled) to
    // keep the same all-or-nothing propagation an unexpected (non-SlotFullError)
    // error already had in the sequential version.
    const outcomes = await Promise.all(rows.map(async (row) => {
        const apptLike = {
            id: row.original_appointment_id, patient_id: row.patient_id, doctor_id: row.doctor_id,
            appointment_date: row.appointment_date, shift: row.shift,
            phone_number: row.phone_number, doctor_name: row.doctor_name
        };
        const target = await rescheduleService.findRescheduleTarget(apptLike, hospitalId);
        if (!target) return false;

        let result;
        try {
            result = await rescheduleService.commitReschedule(apptLike, target, hospitalId, 'a slot opening up');
        } catch (err) {
            // Same token-allocation race noted in rescheduleService — the
            // target looked open a moment ago; if it's genuinely gone now,
            // leave this row Waiting for the next retry rather than aborting
            // every other waiting patient's attempt.
            if (err instanceof bookingService.SlotFullError) return false;
            throw err;
        }
        await db.query(
            `UPDATE waiting_list SET status = 'Booked', resulting_appointment_id = ?, resolved_at = NOW() WHERE id = ?`,
            [result.newAppointmentId, row.id]
        );
        return true;
    }));
    return outcomes.filter(Boolean).length;
}

async function listWaitingList(hospitalId, status = 'Waiting') {
    const [rows] = await db.query(
        `SELECT w.*, p.name AS patient_name, p.phone_number, doc.name AS doctor_name, dep.name_en AS department_name
         FROM waiting_list w
         JOIN patients p ON p.id = w.patient_id
         JOIN doctors doc ON doc.id = w.doctor_id
         JOIN departments dep ON dep.id = doc.department_id
         WHERE p.hospital_id = ? AND w.status = ?
         ORDER BY w.created_at ASC`,
        [hospitalId, status]
    );
    return rows;
}

module.exports = { retryWaitingList, listWaitingList };
