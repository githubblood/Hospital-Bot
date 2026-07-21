const db = require('../config/db');
const catalogService = require('./catalogService');
const bookingService = require('./bookingService');
const whatsappService = require('./whatsappService');
const queueAdminService = require('./queueAdminService');
const appointmentStateMachine = require('./appointmentStateMachine');
const capacityController = require('../rule_engine/capacityController');
const doctorAdminService = require('./doctorAdminService');
const { bi, cleanDoctorName, formatDateDisplay, formatTime } = require('../rule_engine/messages');

// Only these statuses may ever become 'Rescheduled' — see
// appointmentStateMachine's transition map. Checked up front, before a new
// replacement appointment is created, so an already-terminal row (Cancelled/
// Completed/Rescheduled/No Show) can't cause an orphaned new booking with no
// valid old row to link back to.
const RESCHEDULABLE_STATUSES = ['Confirmed', 'Waitlisted'];

const SHIFT_ORDER = { Morning: 0, Afternoon: 1, Evening: 2 };
const SEARCH_DAYS_AHEAD = 21;

async function loadHospital(hospitalId) {
    const [rows] = await db.query('SELECT * FROM hospitals WHERE id = ?', [hospitalId]);
    return rows[0] || null;
}

// Every doctor in `departmentId` except `excludeDoctorId`'s own next opening,
// earliest wins (date, then Morning<Afternoon<Evening). catalogService.getDoctors
// already excludes on-leave doctors.
async function findNextSlotInDepartment(departmentId, excludeDoctorId, hospitalId, daysAhead = SEARCH_DAYS_AHEAD) {
    const doctors = await catalogService.getDoctors(departmentId);
    let best = null;
    for (const doctor of doctors) {
        if (doctor.id === excludeDoctorId) continue;
        const next = await bookingService.getNextAvailable(doctor, daysAhead, hospitalId);
        if (!next) continue;
        if (!best || next.date < best.date || (next.date === best.date && SHIFT_ORDER[next.shift] < SHIFT_ORDER[best.shift])) {
            best = { ...next, doctor };
        }
    }
    return best;
}

// Pure search — no writes, no notifications. Tier 1: same doctor's next
// opening. Tier 2: same department, any other doctor's next opening
// (earliest wins). Returns null if neither tier finds anything, meaning the
// caller should waitlist.
async function findRescheduleTarget(appt, hospitalId) {
    const doctor = await catalogService.getDoctorById(appt.doctor_id);
    if (!doctor) return null;

    const sameDoctor = await bookingService.getNextAvailable(doctor, SEARCH_DAYS_AHEAD, hospitalId);
    if (sameDoctor) {
        return { tier: 'SameDoctor', targetDoctorId: doctor.id, date: sameDoctor.date, shift: sameDoctor.shift };
    }

    const otherDept = await findNextSlotInDepartment(doctor.department_id, doctor.id, hospitalId);
    if (otherDept) {
        return { tier: 'SameDepartment', targetDoctorId: otherDept.doctor.id, date: otherDept.date, shift: otherDept.shift };
    }

    return null;
}

async function notifyRescheduled(appt, target, created, hospitalCreds, reasonNote, oldDoctorName, newDoctorName) {
    const dnOld = cleanDoctorName(oldDoctorName);
    const dnNew = cleanDoctorName(newDoctorName);
    const when = `${formatDateDisplay(target.date)} (${target.shift}), Token #${created.tokenNumber}, ${formatTime(created.expectedTime)}`;

    const en = target.tier === 'SameDepartment'
        ? `Due to ${reasonNote}, your appointment with Dr. ${dnOld} could not be kept — you've been moved to Dr. ${dnNew} on ${when}.`
        : `Due to ${reasonNote}, your appointment with Dr. ${dnOld} has been moved to ${when}.`;
    const hi = target.tier === 'SameDepartment'
        ? `${reasonNote} के कारण, डॉ. ${dnOld} के साथ आपकी अपॉइंटमेंट संभव नहीं रही — आपको डॉ. ${dnNew} के पास ${when} पर शिफ्ट कर दिया गया है।`
        : `${reasonNote} के कारण, डॉ. ${dnOld} के साथ आपकी अपॉइंटमेंट ${when} पर कर दी गई है।`;

    await whatsappService.sendText(hospitalCreds, appt.phone_number, bi(en, hi));
}

async function notifyWaitlisted(appt, hospitalCreds, reasonNote) {
    await whatsappService.sendText(
        hospitalCreds,
        appt.phone_number,
        bi(
            `Due to ${reasonNote}, your appointment could not be automatically rescheduled. You've been placed on our waiting list and will be notified as soon as a slot opens.`,
            `${reasonNote} के कारण, आपकी अपॉइंटमेंट अपने आप दोबारा शेड्यूल नहीं हो सकी। आपको हमारी वेटिंग लिस्ट में डाल दिया गया है और स्लॉट खुलते ही सूचित किया जाएगा।`
        )
    );
}

// Commits a found target: creates the replacement appointment, links it to
// the old row (bookingService.linkReschedule — old row kept as history,
// never mutated in place), refreshes the live queue, and notifies the
// patient. Reused by both the automatic tiered search below and
// waitlistService's retry-on-lift.
async function commitReschedule(appt, target, hospitalId, reasonNote, adminId = null) {
    const hospital = await loadHospital(hospitalId);
    const [doctorRows] = await db.query('SELECT name FROM doctors WHERE id = ?', [target.targetDoctorId]);
    const newDoctor = doctorRows[0];

    const created = await bookingService.createAppointment({
        patientId: appt.patient_id,
        doctorId: target.targetDoctorId,
        date: target.date,
        shift: target.shift,
        hospitalConfig: hospital,
        adminId
    });
    await bookingService.linkReschedule(appt.id, created.id, adminId);
    await queueAdminService.broadcastQueueUpdate(hospitalId, target.targetDoctorId, target.shift);

    const hospitalCreds = { whatsapp_business_phone_id: hospital.whatsapp_business_phone_id, whatsapp_access_token: hospital.whatsapp_access_token };
    await notifyRescheduled(appt, target, created, hospitalCreds, reasonNote, appt.doctor_name, newDoctor ? newDoctor.name : appt.doctor_name);

    return { outcome: 'Rescheduled', tier: target.tier, newAppointmentId: created.id, date: target.date, shift: target.shift };
}

async function waitlist(appt, hospitalId, reasonNote, adminId = null) {
    const transition = await appointmentStateMachine.transitionStatus(appt.id, 'Waitlisted', { adminId });
    // Callers only ever pass an appointment already confirmed to be
    // Confirmed (both scheduleController.createOverride and
    // operatingHoursService.saveOperatingHours source `appt` from an
    // "affected appointments" query scoped to active bookings), so this
    // should never actually fail — guarded anyway so a waiting_list row and
    // a WhatsApp "you're waitlisted" message can never be created for an
    // appointment whose own status didn't actually change.
    if (transition.error) return { outcome: 'Error', error: transition.error };
    await db.query(
        `INSERT INTO waiting_list (patient_id, doctor_id, original_appointment_id, preferred_date, shift)
         VALUES (?, ?, ?, ?, ?)`,
        [appt.patient_id, appt.doctor_id, appt.id, appt.appointment_date, appt.shift]
    );
    const hospital = await loadHospital(hospitalId);
    const hospitalCreds = { whatsapp_business_phone_id: hospital.whatsapp_business_phone_id, whatsapp_access_token: hospital.whatsapp_access_token };
    await notifyWaitlisted(appt, hospitalCreds, reasonNote);
    return { outcome: 'Waitlisted' };
}

// `appt` needs: id, patient_id, doctor_id, appointment_date, shift,
// phone_number, doctor_name — exactly the shape operatingHoursService's
// previewAffectedAppointments / scheduleOverrideService's
// findAffectedAppointments rows already carry, so callers can pass those
// rows straight through with no extra lookup.
async function autoRescheduleAppointment(appt, hospitalId, reasonNote, adminId = null) {
    const target = await findRescheduleTarget(appt, hospitalId);
    if (!target) {
        return waitlist(appt, hospitalId, reasonNote, adminId);
    }
    try {
        return await commitReschedule(appt, target, hospitalId, reasonNote, adminId);
    } catch (err) {
        // Same race manualReschedule guards against: the target slot looked
        // open a moment ago (findRescheduleTarget) but the real token
        // allocation still ran out by the time commitReschedule's
        // createAppointment call landed. Falls back to the waiting list
        // rather than throwing and aborting the rest of a batch (this runs
        // in a loop over every affected appointment — see
        // scheduleController.createOverride / operatingHoursService.saveOperatingHours).
        if (err instanceof bookingService.SlotFullError) {
            return waitlist(appt, hospitalId, reasonNote, adminId);
        }
        throw err;
    }
}

// Receptionist-triggered, non-interactive counterpart to the WhatsApp bot's
// own reschedule flow — same create+link mechanism, explicit doctor/date/shift
// instead of a search.
async function manualReschedule(hospitalId, appointmentId, { doctorId, date, shift, adminId = null }) {
    const [rows] = await db.query(
        `SELECT a.*, p.phone_number, doc.name AS doctor_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         WHERE a.id = ? AND p.hospital_id = ?`,
        [appointmentId, hospitalId]
    );
    const appt = rows[0];
    if (!appt) return { error: 'NOT_FOUND' };
    // Previously unchecked — nothing stopped a Cancelled/Completed/already-
    // Rescheduled appointment from being "rescheduled" again here, which
    // would have created a new booking with no valid old row to link back
    // to. Checked before creating the new appointment (not left to
    // linkReschedule's own guard alone) specifically so a doomed request
    // never allocates a token it can't keep.
    if (!RESCHEDULABLE_STATUSES.includes(appt.status)) {
        return { error: 'INVALID_STATE', message: `Only a Confirmed or Waitlisted appointment can be rescheduled (currently ${appt.status}).` };
    }

    // CRITICAL fix (Stage 3.5): this was the one caller of validateShiftCapacity
    // that never verified `doctorId` actually belongs to `hospitalId` before
    // using it — every sibling booking path (receptionAdminService.
    // createReceptionAppointment) already does this ownership check first.
    // Without it, a Hospital-A admin could reschedule onto a Hospital-B
    // doctor: capacityController.validateShiftCapacity/bookingService.
    // createAppointment both resolve a doctor by raw ID with no hospital
    // filter, so the old appointment (Hospital A's patient) would end up
    // booked against a real doctor belonging to a different tenant — visible
    // in that other hospital's own queue/appointments/reports. Checked here,
    // before capacity validation, per the fix's explicit requirement — a
    // wrong-hospital doctorId must never even reach the capacity check.
    const doctor = await doctorAdminService.getDoctor(hospitalId, doctorId);
    if (!doctor) {
        return { error: 'DOCTOR_NOT_FOUND' };
    }

    const capacity = await capacityController.validateShiftCapacity(doctorId, date, shift, hospitalId);
    if (!capacity.available) {
        return { error: 'SLOT_UNAVAILABLE', reason: capacity.reason };
    }

    const hospital = await loadHospital(hospitalId);
    let created;
    try {
        created = await bookingService.createAppointment({
            patientId: appt.patient_id, doctorId, date, shift, hospitalConfig: hospital, adminId
        });
    } catch (err) {
        // validateShiftCapacity's "remaining" count above only looks at
        // currently-active bookings, but createAppointment's real token
        // allocation is MAX(token_number)+1 over EVERY appointment ever made
        // for that doctor/date/shift, cancelled/rescheduled included (token
        // space only ever grows — see bookingService.createAppointment's own
        // comment) — so a slot that looked open a moment ago can still turn
        // out to be genuinely out of tokens. Same race the WhatsApp bot's own
        // confirmBooking.js/reschedule.js already handle.
        if (err instanceof bookingService.HospitalSuspendedError) {
            return { error: 'HOSPITAL_SUSPENDED' };
        }
        if (err instanceof bookingService.SlotFullError) {
            return { error: 'SLOT_UNAVAILABLE', reason: 'FULL' };
        }
        throw err;
    }
    await bookingService.linkReschedule(appt.id, created.id, adminId);
    await queueAdminService.broadcastQueueUpdate(hospitalId, doctorId, shift);

    const [[newDoctor]] = await db.query('SELECT name FROM doctors WHERE id = ?', [doctorId]);
    const hospitalCreds = { whatsapp_business_phone_id: hospital.whatsapp_business_phone_id, whatsapp_access_token: hospital.whatsapp_access_token };
    const dn = cleanDoctorName(newDoctor ? newDoctor.name : appt.doctor_name);
    await whatsappService.sendText(
        hospitalCreds,
        appt.phone_number,
        bi(
            `Your appointment has been rescheduled by the hospital. New appointment with Dr. ${dn} on ${formatDateDisplay(date)} (${shift}), Token #${created.tokenNumber}, ${formatTime(created.expectedTime)}.`,
            `अस्पताल द्वारा आपकी अपॉइंटमेंट दोबारा शेड्यूल कर दी गई है। नई अपॉइंटमेंट डॉ. ${dn} के साथ ${formatDateDisplay(date)} (${shift}) को, टोकन #${created.tokenNumber}, ${formatTime(created.expectedTime)} पर है।`
        )
    );

    // `success: true` added alongside the pre-existing `rescheduled: true`
    // (kept for whatever already reads it) — this was the one appointment
    // endpoint whose success shape didn't match every other one's
    // `{ success: true, ... }` convention (API consistency review).
    return { success: true, rescheduled: true, newAppointmentId: created.id };
}

module.exports = {
    findRescheduleTarget,
    commitReschedule,
    autoRescheduleAppointment,
    manualReschedule
};
