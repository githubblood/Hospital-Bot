const db = require('../config/db');
const whatsappService = require('../services/whatsappService');
const appointmentAdminService = require('../services/appointmentAdminService');
const doctorAdminService = require('../services/doctorAdminService');
const queueAdminService = require('../services/queueAdminService');
const settingsAdminService = require('../services/settingsAdminService');
const { bi, formatDateDisplay, formatTime } = require('../rule_engine/messages');

// Reception/staff-side confirmation that an offline/manual payment (cash, UPI,
// card at counter) came through. There's no payment gateway wired up here — the
// blueprint didn't specify one — so this is the manual completion of the
// Pending_Payment -> Confirmed transition described in the schema.
exports.confirmPayment = async (req, res) => {
    const appointmentId = req.params.id;

    const [rows] = await db.query(
        `SELECT a.*, p.phone_number, h.whatsapp_business_phone_id, h.whatsapp_access_token
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors d ON d.id = a.doctor_id
         JOIN hospitals h ON h.id = p.hospital_id
         WHERE a.id = ? AND a.status = 'Pending_Payment'`,
        [appointmentId]
    );

    if (rows.length === 0) {
        return res.status(404).json({ error: 'No pending-payment appointment found with that id' });
    }

    const appt = rows[0];
    await db.query(
        `UPDATE appointments SET status = 'Confirmed', payment_status = 'Paid' WHERE id = ?`,
        [appointmentId]
    );

    const hospital = {
        whatsapp_business_phone_id: appt.whatsapp_business_phone_id,
        whatsapp_access_token: appt.whatsapp_access_token
    };
    await whatsappService.sendText(
        hospital,
        appt.phone_number,
        bi(
            `✅ Payment received. Your appointment on ${formatDateDisplay(appt.appointment_date)} (${appt.shift}) is confirmed. Token #${appt.token_number}, expected time ${formatTime(appt.expected_time)}.`,
            `✅ भुगतान प्राप्त हुआ। ${formatDateDisplay(appt.appointment_date)} (${appt.shift}) की आपकी अपॉइंटमेंट कन्फर्म है। टोकन #${appt.token_number}, अनुमानित समय ${formatTime(appt.expected_time)}।`
        )
    );

    res.json({ success: true, appointmentId: Number(appointmentId), status: 'Confirmed', payment_status: 'Paid' });
};

// Scenario 5 — Reception Approval Flow. Staff review a Pending request and
// either approve it (Pending -> Confirmed) or reject it (Pending -> Cancelled);
// the patient is notified over WhatsApp of the async decision. Unscoped by
// hospital (no hospitalId passed) — matches this route's existing behavior
// under the single global ADMIN_API_KEY. The JWT-authenticated admin panel
// calls the same service functions WITH a hospitalId (see adminAppointmentsController.js).
exports.approveAppointment = async (req, res) => {
    const result = await appointmentAdminService.approveAppointment(req.params.id);
    if (!result) {
        return res.status(404).json({ error: 'No pending appointment found with that id' });
    }
    res.json({ success: true, ...result });
};

exports.rejectAppointment = async (req, res) => {
    const reason = (req.body && req.body.reason) ? String(req.body.reason) : null;
    const result = await appointmentAdminService.rejectAppointment(req.params.id, undefined, reason);
    if (!result) {
        return res.status(404).json({ error: 'No pending appointment found with that id' });
    }
    res.json({ success: true, ...result });
};

// ---- Static-key automation endpoints (Module 3) ----
// Unlike approve/reject above, these need a hospital_id in the body: there's
// no JWT here to derive it from, and toggling a doctor's leave flag or a
// hospital's feature switches genuinely is hospital-scoped data (two
// hospitals could otherwise collide on the same doctor/hospital id from a
// misconfigured caller). All three just call the exact same service
// functions the JWT-authenticated admin panel already uses.
exports.toggleDoctorLeave = async (req, res) => {
    const { hospital_id: hospitalId, doctor_id: doctorId } = req.body || {};
    if (!hospitalId || !doctorId) {
        return res.status(400).json({ error: 'hospital_id and doctor_id are required' });
    }
    const result = await doctorAdminService.toggleLeave(hospitalId, doctorId);
    if (!result) {
        return res.status(404).json({ error: 'Doctor not found for that hospital' });
    }
    res.json({ success: true, ...result });
};

// Marks the current token Completed and (via queueAdminService) notifies
// whoever is now next and pushes the update to any live-queue SSE dashboard —
// the identical behavior the JWT-protected PATCH /queue/next uses, just
// reachable here with the static ADMIN_API_KEY for external automation
// (e.g. a physical token-calling device with no admin login).
exports.advanceQueue = async (req, res) => {
    const { hospital_id: hospitalId, appointment_id: appointmentId } = req.body || {};
    if (!hospitalId || !appointmentId) {
        return res.status(400).json({ error: 'hospital_id and appointment_id are required' });
    }
    const result = await queueAdminService.markCurrentDone(hospitalId, appointmentId);
    if (!result) {
        return res.status(404).json({ error: 'No active (non-completed, non-cancelled) appointment found with that id' });
    }
    res.json({ success: true, ...result });
};

exports.updateHospitalConfig = async (req, res) => {
    const { hospital_id: hospitalId, ...flags } = req.body || {};
    if (!hospitalId) {
        return res.status(400).json({ error: 'hospital_id is required' });
    }
    await settingsAdminService.updateFeatures(hospitalId, flags);
    res.json({ success: true });
};
