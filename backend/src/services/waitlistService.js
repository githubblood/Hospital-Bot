const db = require('../config/db');
const rescheduleService = require('./rescheduleService');
const bookingService = require('./bookingService');
const whatsappService = require('./whatsappService');
const { bi } = require('../webhook/messages');
const langContext = require('../webhook/helpers/langContext');
const { getPreferredLanguage } = require('../webhook/helpers/sessionManager');

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

// Sent once, right after scheduleController.liftOverride's retryWaitingList
// call above — only to patients THIS override stranded (caused_by_override_id
// match) who are STILL 'Waiting' after that retry just tried and failed to
// rebook them (anyone it DID rebook already got a specific "you're now
// booked for X" message from commitReschedule's own notifyRescheduled — a
// second generic message here would be redundant, so this deliberately
// excludes them by only querying rows still 'Waiting'). Never a hospital-wide
// broadcast: an unrelated patient waiting on a *different*, still-active
// override is correctly left alone.
async function notifyStillWaitingForOverride(hospitalId, overrideId) {
    const [rows] = await db.query(
        `SELECT p.phone_number
         FROM waiting_list w
         JOIN patients p ON p.id = w.patient_id
         WHERE p.hospital_id = ? AND w.caused_by_override_id = ? AND w.status = 'Waiting'`,
        [hospitalId, overrideId]
    );
    if (rows.length === 0) return 0;

    const [[hospital]] = await db.query('SELECT name, whatsapp_business_phone_id, whatsapp_access_token FROM hospitals WHERE id = ?', [hospitalId]);
    const hospitalCreds = { whatsapp_business_phone_id: hospital.whatsapp_business_phone_id, whatsapp_access_token: hospital.whatsapp_access_token };

    await Promise.all(rows.map(async (row) => {
        const lang = await getPreferredLanguage(row.phone_number);
        await langContext.run(lang, () => whatsappService.sendText(
            hospitalCreds,
            row.phone_number,
            bi(
                `🏥 ${hospital.name}\n\nGood news! The hospital has resumed normal operations. Online appointment booking is now available again.\n\nYour appointment was affected during the emergency — you may now book again, or contact reception. Thank you.`,
                `🏥 ${hospital.name}\n\nखुशखबरी! अस्पताल में सामान्य कामकाज दोबारा शुरू हो गया है। ऑनलाइन अपॉइंटमेंट बुकिंग अब फिर से उपलब्ध है।\n\nआपकी अपॉइंटमेंट इमरजेंसी के दौरान प्रभावित हुई थी — अब आप दोबारा बुक कर सकते हैं, या रिसेप्शन से संपर्क करें। धन्यवाद।`
            )
        ));
    }));
    return rows.length;
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

module.exports = { retryWaitingList, notifyStillWaitingForOverride, listWaitingList };
