const db = require('../config/db');
const patientService = require('../services/patientService');
const doctorAdminService = require('./doctorAdminService');
const capacityController = require('../rule_engine/capacityController');
const bookingService = require('./bookingService');
const queueAdminService = require('./queueAdminService');
const appointmentStateMachine = require('./appointmentStateMachine');
const appointmentHistoryService = require('./appointmentHistoryService');

// Single query, conditional-aggregate style — same pattern adminStatsService
// already uses for its own dashboard cards. "In Consultation"/"Waiting"/
// "Checked In" are only meaningful while status is still 'Confirmed';
// checkin_status is left untouched once an appointment goes terminal (see
// schema.sql's comment), so every one of these conditions pins status too —
// otherwise a long-completed appointment would still count as "in
// consultation" forever.
async function getDashboardStats(hospitalId, date) {
    const [[stats]] = await db.query(
        `SELECT
            COUNT(*) AS total,
            SUM(a.status = 'Confirmed' AND a.checkin_status = 'Waiting') AS waiting,
            SUM(a.status = 'Confirmed' AND a.checkin_status = 'Checked In') AS checked_in,
            SUM(a.status = 'Confirmed' AND a.checkin_status = 'In Consultation') AS in_consultation,
            SUM(a.status = 'Completed') AS completed,
            SUM(a.status = 'Cancelled') AS cancelled,
            SUM(a.status = 'No Show') AS no_show,
            SUM(a.booking_source = 'Walk-in') AS walk_in
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.appointment_date = ?`,
        [hospitalId, date]
    );
    return {
        total: stats.total,
        waiting: Number(stats.waiting) || 0,
        checkedIn: Number(stats.checked_in) || 0,
        inConsultation: Number(stats.in_consultation) || 0,
        completed: Number(stats.completed) || 0,
        cancelled: Number(stats.cancelled) || 0,
        noShow: Number(stats.no_show) || 0,
        walkIn: Number(stats.walk_in) || 0
    };
}

// Resolves an existing patient (ownership-checked) or creates a new one via
// the same shared patientService.createPatient the WhatsApp bot uses — one
// patient-creation path, one UHID generation point.
async function resolvePatient(hospitalId, { patientId, newPatient }) {
    if (patientId) {
        const patient = await patientService.getPatientById(patientId);
        if (!patient || patient.hospital_id !== hospitalId) return { error: 'PATIENT_NOT_FOUND' };
        return { patient };
    }
    if (newPatient && newPatient.name && newPatient.phone && newPatient.age && newPatient.gender) {
        const patient = await patientService.createPatient(
            hospitalId, newPatient.phone.trim(), newPatient.name.trim(), Number(newPatient.age), newPatient.gender
        );
        return { patient };
    }
    return { error: 'PATIENT_REQUIRED' };
}

// Powers both "Manual Appointment Booking" and "Walk-in Registration" — they
// differ only in `source`/`checkInNow`/whether `date` is caller-supplied
// (manual) or forced to today (walk-in controller passes today's date), not
// in how the appointment itself gets created. Reuses exactly the same
// validation and booking mechanics the WhatsApp bot and rescheduleService
// already go through — capacityController.validateShiftCapacity (doctor
// availability/leave/hospital-hours-via-overrides/holiday/slot-capacity, the
// same function rescheduleService.manualReschedule already calls) followed
// by bookingService.createAppointment (token allocation, plus the shared
// past-date and duplicate-booking guards added for this stage — those apply
// here for free, no second copy of either rule).
async function createReceptionAppointment(hospitalId, adminId, { patientId, newPatient, doctorId, date, shift, source, checkInNow }) {
    const patientResult = await resolvePatient(hospitalId, { patientId, newPatient });
    if (patientResult.error) return patientResult;
    const patient = patientResult.patient;

    const doctor = await doctorAdminService.getDoctor(hospitalId, doctorId);
    if (!doctor) return { error: 'DOCTOR_NOT_FOUND' };

    const capacity = await capacityController.validateShiftCapacity(doctorId, date, shift, hospitalId);
    if (!capacity.available) {
        return { error: 'SLOT_UNAVAILABLE', reason: capacity.reason };
    }

    const [[hospital]] = await db.query('SELECT * FROM hospitals WHERE id = ?', [hospitalId]);

    let created;
    try {
        // adminId threaded through so the one shared creation-audit entry
        // (now logged inside createAppointment itself, not a second call
        // here) is correctly attributed to the receptionist, not left blank
        // the way a bot-created appointment's entry is.
        created = await bookingService.createAppointment({
            patientId: patient.id, doctorId, date, shift, hospitalConfig: hospital, adminId
        });
    } catch (err) {
        if (err instanceof bookingService.DuplicateBookingError) return { error: 'DUPLICATE_BOOKING' };
        if (err instanceof bookingService.PastDateError) return { error: 'PAST_DATE' };
        // Reached only if requireActiveHospital's route-level check (the
        // primary guard for Reception) is ever bypassed — this is the
        // defense-in-depth backstop since every appointment creation funnels
        // through bookingService.createAppointment regardless of caller.
        if (err instanceof bookingService.HospitalSuspendedError) return { error: 'HOSPITAL_SUSPENDED' };
        if (err instanceof bookingService.SlotFullError) return { error: 'SLOT_UNAVAILABLE', reason: 'FULL' };
        throw err;
    }

    await db.query(
        'UPDATE appointments SET booking_source = ? WHERE id = ?',
        [source === 'Walk-in' ? 'Walk-in' : 'Reception', created.id]
    );

    // Walk-ins are inherently already physically present; a manual booking
    // only checks in immediately if the receptionist explicitly says so
    // (e.g. booking for a patient standing at the counter right now). Goes
    // through the same transitionCheckin the standalone checkIn() below
    // uses, rather than a third copy of this exact UPDATE.
    const shouldCheckIn = source === 'Walk-in' || !!checkInNow;
    if (shouldCheckIn && created.status === 'Confirmed') {
        await appointmentStateMachine.transitionCheckin(created.id, 'Checked In', {
            adminId, extraFields: { checked_in_at: new Date(), checked_in_by: adminId }
        });
    }

    await queueAdminService.broadcastQueueUpdate(hospitalId, doctorId, shift);

    return {
        id: created.id,
        tokenNumber: created.tokenNumber,
        expectedTime: created.expectedTime,
        status: created.status,
        patientId: patient.id,
        patientName: patient.name,
        patientUhid: patient.uhid
    };
}

// Ownership-checked single-appointment lookup shared by checkIn/
// startConsultation/markNoShow/getTimeline below instead of four near-
// identical queries. complete() doesn't need it — it delegates entirely to
// queueAdminService.markCurrentDone, which already does its own
// ownership-scoped lookup.
async function loadOwnedAppointment(hospitalId, appointmentId) {
    const [rows] = await db.query(
        `SELECT a.*, p.name AS patient_name, p.phone_number, p.hospital_id, doc.name AS doctor_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         WHERE a.id = ? AND p.hospital_id = ?`,
        [appointmentId, hospitalId]
    );
    return rows[0] || null;
}

async function checkIn(hospitalId, appointmentId, adminId) {
    const appt = await loadOwnedAppointment(hospitalId, appointmentId);
    if (!appt) return { error: 'NOT_FOUND' };

    const transition = await appointmentStateMachine.transitionCheckin(appointmentId, 'Checked In', {
        adminId, extraFields: { checked_in_at: new Date(), checked_in_by: adminId }
    });
    if (transition.error === 'INVALID_STATE') return transition;
    if (transition.error === 'INVALID_TRANSITION') return { error: 'ALREADY_CHECKED_IN' };

    await queueAdminService.broadcastQueueUpdate(hospitalId, appt.doctor_id, appt.shift);
    return { id: Number(appointmentId), checkin_status: 'Checked In' };
}

async function startConsultation(hospitalId, appointmentId, adminId) {
    const appt = await loadOwnedAppointment(hospitalId, appointmentId);
    if (!appt) return { error: 'NOT_FOUND' };

    const transition = await appointmentStateMachine.transitionCheckin(appointmentId, 'In Consultation', { adminId });
    if (transition.error === 'INVALID_STATE') return transition;
    if (transition.error === 'INVALID_TRANSITION') return { error: 'INVALID_STATE', message: 'Patient must be checked in first.' };

    await queueAdminService.broadcastQueueUpdate(hospitalId, appt.doctor_id, appt.shift);
    return { id: Number(appointmentId), checkin_status: 'In Consultation' };
}

// Reuses queueAdminService.markCurrentDone rather than duplicating the
// "complete + notify next patient" logic — Reception's "Completed" action
// and Queue Management's "Call Next" button are the same real-world action.
async function complete(hospitalId, appointmentId, adminId) {
    const result = await queueAdminService.markCurrentDone(hospitalId, appointmentId, adminId);
    if (!result) return { error: 'NOT_FOUND' };
    return { id: Number(appointmentId), status: 'Completed' };
}

// Manual only, per the explicit spec — no automatic end-of-day sweep.
async function markNoShow(hospitalId, appointmentId, adminId) {
    const appt = await loadOwnedAppointment(hospitalId, appointmentId);
    if (!appt) return { error: 'NOT_FOUND' };

    const transition = await appointmentStateMachine.transitionStatus(appointmentId, 'No Show', { adminId });
    if (transition.error) {
        return { error: 'INVALID_STATE', message: `Only a Confirmed appointment can be marked No Show (currently ${appt.status}).` };
    }

    await queueAdminService.broadcastQueueUpdate(hospitalId, appt.doctor_id, appt.shift);
    return { id: Number(appointmentId), status: 'No Show' };
}

async function getTimeline(hospitalId, appointmentId) {
    const appt = await loadOwnedAppointment(hospitalId, appointmentId);
    if (!appt) return null;
    return appointmentHistoryService.listForAppointment(appointmentId);
}

module.exports = {
    getDashboardStats, createReceptionAppointment,
    checkIn, startConsultation, complete, markNoShow, getTimeline
};
