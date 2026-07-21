const appointmentAdminService = require('../services/appointmentAdminService');
const doctorAdminService = require('../services/doctorAdminService');
const queueAdminService = require('../services/queueAdminService');
const settingsAdminService = require('../services/settingsAdminService');

// Reception/staff-side confirmation that an offline/manual payment (cash, UPI,
// card at counter) came through. There's no payment gateway wired up here — the
// blueprint didn't specify one — so this is the manual completion of the
// Pending_Payment -> Confirmed transition described in the schema. The
// transition itself (and its audit entry) lives in appointmentAdminService —
// controllers never write appointment status directly (stabilization pass).
//
// hospital_id is now REQUIRED in the body (Stage 3.5 fix — this route used to
// call the service with hospitalId undefined, which made its WHERE clause
// unscoped: since ADMIN_API_KEY is one single global secret shared across
// every tenant, any holder of it could confirm-payment/approve/reject ANY
// hospital's appointment by numeric id alone. toggleDoctorLeave/advanceQueue/
// updateHospitalConfig below already required hospital_id for this exact
// reason — this brings these three in line with that same convention).
exports.confirmPayment = async (req, res) => {
    const { hospital_id: hospitalId } = req.body || {};
    if (!hospitalId) {
        return res.status(400).json({ error: 'hospital_id is required' });
    }
    const result = await appointmentAdminService.confirmPayment(req.params.id, hospitalId, undefined);
    if (!result) {
        return res.status(404).json({ error: 'No pending-payment appointment found with that id' });
    }
    res.json({ success: true, ...result });
};

// Scenario 5 — Reception Approval Flow. Staff review a Pending request and
// either approve it (Pending -> Confirmed) or reject it (Pending -> Cancelled);
// the patient is notified over WhatsApp of the async decision. The
// JWT-authenticated admin panel calls the same service functions WITH a
// hospitalId (see adminAppointmentsController.js) — this route now requires
// the caller supply the same, see confirmPayment's comment above.
exports.approveAppointment = async (req, res) => {
    const { hospital_id: hospitalId } = req.body || {};
    if (!hospitalId) {
        return res.status(400).json({ error: 'hospital_id is required' });
    }
    const result = await appointmentAdminService.approveAppointment(req.params.id, hospitalId);
    if (!result) {
        return res.status(404).json({ error: 'No pending appointment found with that id' });
    }
    res.json({ success: true, ...result });
};

exports.rejectAppointment = async (req, res) => {
    const { hospital_id: hospitalId, reason: rawReason } = req.body || {};
    if (!hospitalId) {
        return res.status(400).json({ error: 'hospital_id is required' });
    }
    const reason = rawReason ? String(rawReason) : null;
    const result = await appointmentAdminService.rejectAppointment(req.params.id, hospitalId, reason);
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
