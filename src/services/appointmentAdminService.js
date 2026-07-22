const db = require('../config/db');
const whatsappService = require('./whatsappService');
const appointmentStateMachine = require('./appointmentStateMachine');
const { bi, cleanDoctorName, formatDate, formatDateDisplay, formatTime } = require('../rule_engine/messages');

// Safety cap (Stage 3.5 perf review) — this had no LIMIT at all before, so a
// hospital's full appointment history (or a filterless search) returned in
// one unbounded response. Not real pagination (no offset/page UI exists yet
// on any caller), just a backstop against an unbounded pull; every existing
// caller stays byte-for-byte compatible unless a hospital genuinely has more
// than this many matching rows.
const MAX_RESULTS = 1000;

// hospitalId is optional throughout: omitted, the query is unscoped (used by
// the static-ADMIN_API_KEY automation routes, matching their existing
// behavior); provided, results are restricted to that hospital's patients
// (used by the JWT-authenticated admin panel, which belongs to one hospital).

// search/departmentId/appointmentId are additive filters (Reception's
// appointment search reuses this exact function rather than a second query) —
// every existing caller (appointments.html, the static-key automation
// routes) simply never passes them, so nothing about their behavior changes.
async function listAppointments(hospitalId, filters = {}) {
    const { date, status, doctorId, departmentId, appointmentId, search } = filters;
    const params = [];
    let where = '1=1';
    if (hospitalId) { where += ' AND p.hospital_id = ?'; params.push(hospitalId); }
    if (date) { where += ' AND a.appointment_date = ?'; params.push(date); }
    if (status) { where += ' AND a.status = ?'; params.push(status); }
    if (doctorId) { where += ' AND a.doctor_id = ?'; params.push(doctorId); }
    if (departmentId) { where += ' AND doc.department_id = ?'; params.push(departmentId); }
    if (appointmentId) { where += ' AND a.id = ?'; params.push(appointmentId); }
    if (search) {
        where += ' AND (p.name ILIKE ? OR p.phone_number ILIKE ? OR p.uhid ILIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
        `SELECT a.id, a.doctor_id, a.appointment_date, a.shift, a.token_number, a.expected_time, a.status, a.payment_status,
                a.checkin_status, a.checked_in_at, a.booking_source, a.cancel_reason, a.cancelled_at,
                a.reminder_sent, a.reminder_sent_at, a.rescheduled_from, a.rescheduled_to,
                p.id AS patient_id, p.name AS patient_name, p.phone_number, p.uhid AS patient_uhid,
                doc.name AS doctor_name, doc.department_id
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         WHERE ${where}
         ORDER BY a.appointment_date DESC, a.expected_time ASC
         LIMIT ?`,
        [...params, MAX_RESULTS]
    );
    return rows.map(r => ({ ...r, appointment_date: formatDate(r.appointment_date), doctor_name: cleanDoctorName(r.doctor_name) }));
}

async function getAppointmentById(hospitalId, appointmentId) {
    const params = [appointmentId];
    let where = 'a.id = ?';
    if (hospitalId) { where += ' AND p.hospital_id = ?'; params.push(hospitalId); }

    const [rows] = await db.query(
        `SELECT a.*, p.name AS patient_name, p.phone_number, p.age, p.gender,
                doc.name AS doctor_name, doc.consultation_fee
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         WHERE ${where}`,
        params
    );
    if (!rows[0]) return null;
    return { ...rows[0], appointment_date: formatDate(rows[0].appointment_date), doctor_name: cleanDoctorName(rows[0].doctor_name) };
}

function hospitalCreds(row) {
    return { whatsapp_business_phone_id: row.whatsapp_business_phone_id, whatsapp_access_token: row.whatsapp_access_token };
}

async function loadForNotify(appointmentId, expectedStatus, hospitalId) {
    const params = [appointmentId, expectedStatus];
    let where = 'a.id = ? AND a.status = ?';
    if (hospitalId) { where += ' AND p.hospital_id = ?'; params.push(hospitalId); }

    const [rows] = await db.query(
        `SELECT a.*, p.phone_number, doc.name AS doctor_name,
                h.whatsapp_business_phone_id, h.whatsapp_access_token
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         JOIN hospitals h ON h.id = p.hospital_id
         WHERE ${where}`,
        params
    );
    return rows[0] || null;
}

async function approveAppointment(appointmentId, hospitalId, adminId) {
    const appt = await loadForNotify(appointmentId, 'Pending', hospitalId);
    if (!appt) return null;

    await appointmentStateMachine.transitionStatus(appointmentId, 'Confirmed', { adminId });
    const dn = cleanDoctorName(appt.doctor_name);
    await whatsappService.sendText(
        hospitalCreds(appt),
        appt.phone_number,
        bi(
            `✅ Good news! Your appointment with Dr. ${dn} on ${formatDateDisplay(appt.appointment_date)} (${appt.shift}) has been approved and confirmed. Token #${appt.token_number}, expected time ${formatTime(appt.expected_time)}.`,
            `✅ खुशखबरी! डॉ. ${dn} के साथ ${formatDateDisplay(appt.appointment_date)} (${appt.shift}) की आपकी अपॉइंटमेंट मंज़ूर होकर कन्फर्म हो गई है। टोकन #${appt.token_number}, अनुमानित समय ${formatTime(appt.expected_time)}।`
        )
    );
    return { appointmentId: Number(appointmentId), status: 'Confirmed' };
}

// Moved here from adminController.js during the post-Reception stabilization
// pass — a controller was writing `UPDATE appointments SET status = ...`
// directly, the one remaining violation of "every status change goes
// through the shared service" found in that audit. Same Pending_Payment ->
// Confirmed transition, same notification, now with an audit entry too
// (this transition previously had none at all).
async function confirmPayment(appointmentId, hospitalId, adminId) {
    const appt = await loadForNotify(appointmentId, 'Pending_Payment', hospitalId);
    if (!appt) return null;

    await appointmentStateMachine.transitionStatus(appointmentId, 'Confirmed', {
        adminId, extraFields: { payment_status: 'Paid' }
    });
    const dn = cleanDoctorName(appt.doctor_name);
    await whatsappService.sendText(
        hospitalCreds(appt),
        appt.phone_number,
        bi(
            `✅ Payment received. Your appointment on ${formatDateDisplay(appt.appointment_date)} (${appt.shift}) is confirmed. Token #${appt.token_number}, expected time ${formatTime(appt.expected_time)}.`,
            `✅ भुगतान प्राप्त हुआ। ${formatDateDisplay(appt.appointment_date)} (${appt.shift}) की आपकी अपॉइंटमेंट कन्फर्म है। टोकन #${appt.token_number}, अनुमानित समय ${formatTime(appt.expected_time)}।`
        )
    );
    return { appointmentId: Number(appointmentId), status: 'Confirmed', payment_status: 'Paid' };
}

// Fixed a real pre-existing bug while adding Reception's cancellation audit
// trail: this and adminCancelAppointment below both accepted a `reason` and
// used it in the outbound WhatsApp message, but never actually persisted it
// to cancel_reason/cancelled_at — the columns existed (added for the
// WhatsApp self-cancel path, bookingService.cancelAppointment) but these two
// admin-initiated paths silently never wrote them. Now both do, plus the new
// cancelled_by + history entry.
async function rejectAppointment(appointmentId, hospitalId, reason, adminId) {
    const appt = await loadForNotify(appointmentId, 'Pending', hospitalId);
    if (!appt) return null;

    await appointmentStateMachine.transitionStatus(appointmentId, 'Cancelled', {
        adminId, extraFields: { cancelled_at: new Date(), cancel_reason: reason, cancelled_by: adminId || null }
    });
    const dn = cleanDoctorName(appt.doctor_name);
    await whatsappService.sendText(
        hospitalCreds(appt),
        appt.phone_number,
        bi(
            `We're sorry — your appointment request with Dr. ${dn} on ${formatDateDisplay(appt.appointment_date)} (${appt.shift}) could not be approved${reason ? ` (${reason})` : ''}. Please reply 'menu' to book a different slot.`,
            `क्षमा करें — डॉ. ${dn} के साथ ${formatDateDisplay(appt.appointment_date)} (${appt.shift}) की आपकी अपॉइंटमेंट मंज़ूर नहीं हो सकी${reason ? ` (${reason})` : ''}। दूसरा स्लॉट बुक करने के लिए 'menu' लिखें।`
        )
    );
    return { appointmentId: Number(appointmentId), status: 'Cancelled' };
}

// Staff-initiated cancellation of ANY active appointment (not just Pending) —
// distinct from reject, and from the patient's own self-service cancel in the
// WhatsApp "My Appointments" flow (bookingService.cancelAppointment), which is
// scoped by patient_id instead and doesn't need to notify the initiator.
async function adminCancelAppointment(appointmentId, hospitalId, reason, adminId) {
    const params = [appointmentId];
    // Ownership/existence only — "is this row's current status even
    // allowed to become Cancelled" is now the state machine's job below, not
    // a status filter duplicated here. (Previously excluded exactly
    // status='Cancelled'; now also correctly rejects trying to "cancel" an
    // already-Completed/Rescheduled/No-Show row, which the old WHERE let
    // through — a real gap, since none of those should ever go back to
    // Cancelled.)
    let where = 'a.id = ?';
    if (hospitalId) { where += ' AND p.hospital_id = ?'; params.push(hospitalId); }

    const [rows] = await db.query(
        `SELECT a.*, p.phone_number, doc.name AS doctor_name,
                h.whatsapp_business_phone_id, h.whatsapp_access_token
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         JOIN hospitals h ON h.id = p.hospital_id
         WHERE ${where}`,
        params
    );
    const appt = rows[0];
    if (!appt) return null;

    const transition = await appointmentStateMachine.transitionStatus(appointmentId, 'Cancelled', {
        adminId, extraFields: { cancelled_at: new Date(), cancel_reason: reason, cancelled_by: adminId || null }
    });
    // Same external contract as before this refactor: any reason the
    // appointment can't be cancelled (not found, or already terminal) is a
    // single "no active appointment" 404 from the controller — not a new
    // response shape a caller would need to handle differently.
    if (transition.error) return null;
    const dn = cleanDoctorName(appt.doctor_name);
    await whatsappService.sendText(
        hospitalCreds(appt),
        appt.phone_number,
        bi(
            `Your appointment with Dr. ${dn} on ${formatDateDisplay(appt.appointment_date)} (${appt.shift}) has been cancelled by the hospital${reason ? ` (${reason})` : ''}. Please reply 'menu' to book another slot.`,
            `डॉ. ${dn} के साथ ${formatDateDisplay(appt.appointment_date)} (${appt.shift}) की आपकी अपॉइंटमेंट अस्पताल द्वारा रद्द कर दी गई है${reason ? ` (${reason})` : ''}। दूसरा स्लॉट बुक करने के लिए 'menu' लिखें।`
        )
    );
    return { appointmentId: Number(appointmentId), status: 'Cancelled' };
}

// Hard delete — distinct from cancel above, which just flips status and
// notifies the patient. This is for clearing out clutter (old test/duplicate
// rows) from the admin panel's list, not a patient-facing action, so there's
// no notification here. bills.appointment_id is ON DELETE CASCADE (schema.sql),
// so any bill tied to this appointment goes with it — acceptable since a
// deleted appointment's bill has nothing left to be a record of.
// Cancelled-only, same reasoning as deleteCancelledAppointments below: Delete
// is for clearing out clutter (old/test/cancelled rows), not a shortcut
// around Cancel for a live booking — a Confirmed/Pending/Completed row could
// otherwise be permanently removed with no patient notification and no
// record, unlike every other status-changing action in this admin panel.
async function deleteAppointment(hospitalId, appointmentId) {
    const params = [appointmentId];
    let where = 'a.id = ?';
    if (hospitalId) { where += ' AND p.hospital_id = ?'; params.push(hospitalId); }

    const [rows] = await db.query(
        `SELECT a.id, a.status FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE ${where}`,
        params
    );
    if (!rows[0]) return { error: 'NOT_FOUND' };
    if (rows[0].status !== 'Cancelled') return { error: 'NOT_CANCELLED' };

    await db.query('DELETE FROM appointments WHERE id = ?', [appointmentId]);
    return { deleted: true };
}

// Bulk cleanup for the common case shown in the admin panel: a long tail of
// Cancelled rows from testing/duplicate bookings. Scoped to Cancelled only —
// a "delete everything" button would be far too easy to misuse on real data.
async function deleteCancelledAppointments(hospitalId) {
    const [result] = await db.query(
        `DELETE a FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.status = 'Cancelled'`,
        [hospitalId]
    );
    return result.affectedRows;
}

module.exports = {
    listAppointments, getAppointmentById, approveAppointment, rejectAppointment,
    adminCancelAppointment, confirmPayment, deleteAppointment, deleteCancelledAppointments
};
