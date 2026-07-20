const db = require('../config/db');
const patientService = require('../services/patientService');
const scheduleService = require('../services/scheduleService');
const M = require('./messages');

// Real-time "where do I stand right now" lookup for a patient with a
// Confirmed appointment today — distinct from the static expected_time
// recorded at booking, since this reflects the queue's *actual* current pace
// (how many Confirmed tokens ahead of them are still unseen), not the
// original estimate from whenever they booked.
//
// Returns a ready-to-send bilingual message string, or null if this patient
// has no Confirmed appointment today (caller decides what to say in that case).
async function getLiveQueueStatus(hospital, userPhone) {
    const patient = await patientService.findPatient(hospital.id, userPhone);
    if (!patient) return null;

    const [apptRows] = await db.query(
        `SELECT a.doctor_id, a.appointment_date, a.shift, a.token_number, d.schedule_json
         FROM appointments a
         JOIN doctors d ON d.id = a.doctor_id
         WHERE a.patient_id = ? AND a.appointment_date = CURDATE() AND a.status = 'Confirmed'
         ORDER BY a.expected_time ASC
         LIMIT 1`,
        [patient.id]
    );
    const appt = apptRows[0];
    if (!appt) return null;

    const dateStr = M.formatDate(appt.appointment_date);

    const [[aheadRow]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM appointments
         WHERE doctor_id = ? AND appointment_date = ? AND shift = ?
               AND status = 'Confirmed' AND token_number < ?`,
        [appt.doctor_id, dateStr, appt.shift, appt.token_number]
    );
    const patientsAhead = aheadRow.cnt;

    const [[servingRow]] = await db.query(
        `SELECT MAX(token_number) AS maxToken FROM appointments
         WHERE doctor_id = ? AND appointment_date = ? AND shift = ? AND status = 'Completed'`,
        [appt.doctor_id, dateStr, appt.shift]
    );
    const currentlyServing = servingRow.maxToken;

    // Per-patient minutes is the doctor's own configured appointment
    // duration (Booking Capacity) — the same value computeExpectedTime uses
    // at booking time, so this estimate can never drift from the real timing.
    const shiftWindow = scheduleService.getShiftWindow({ schedule_json: appt.schedule_json }, dateStr, appt.shift);
    const avgConsultMins = shiftWindow?.duration_mins || 15;
    const expectedWaitMins = patientsAhead * avgConsultMins;

    return [
        M.bi(`🎫 Token Number : ${appt.token_number}`, `🎫 टोकन नंबर : ${appt.token_number}`),
        M.bi(`▶️ Currently Serving : ${currentlyServing ?? '—'}`, `▶️ अभी सेवा में : ${currentlyServing ?? '—'}`),
        M.bi(`👥 Patients Before You : ${patientsAhead}`, `👥 आपसे पहले मरीज़ : ${patientsAhead}`),
        M.bi(`⏱️ Expected Turn Time : ~${expectedWaitMins} min`, `⏱️ अनुमानित प्रतीक्षा : ~${expectedWaitMins} मिनट`)
    ].join('\n');
}

module.exports = { getLiveQueueStatus };
