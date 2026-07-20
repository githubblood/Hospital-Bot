const db = require('../config/db');
const whatsappService = require('./whatsappService');
const { bi, cleanDoctorName, formatDate, formatDateDisplay, formatTime } = require('../rule_engine/messages');

// hospitalId is optional throughout: omitted, the query is unscoped (used by
// the static-ADMIN_API_KEY automation routes, matching their existing
// behavior); provided, results are restricted to that hospital's patients
// (used by the JWT-authenticated admin panel, which belongs to one hospital).

async function listAppointments(hospitalId, filters = {}) {
    const { date, status, doctorId } = filters;
    const params = [];
    let where = '1=1';
    if (hospitalId) { where += ' AND p.hospital_id = ?'; params.push(hospitalId); }
    if (date) { where += ' AND a.appointment_date = ?'; params.push(date); }
    if (status) { where += ' AND a.status = ?'; params.push(status); }
    if (doctorId) { where += ' AND a.doctor_id = ?'; params.push(doctorId); }

    const [rows] = await db.query(
        `SELECT a.id, a.appointment_date, a.shift, a.token_number, a.expected_time, a.status, a.payment_status,
                a.reminder_sent, a.reminder_sent_at, a.rescheduled_from, a.rescheduled_to,
                p.name AS patient_name, p.phone_number, doc.name AS doctor_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         WHERE ${where}
         ORDER BY a.appointment_date DESC, a.expected_time ASC`,
        params
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

async function approveAppointment(appointmentId, hospitalId) {
    const appt = await loadForNotify(appointmentId, 'Pending', hospitalId);
    if (!appt) return null;

    await db.query(`UPDATE appointments SET status = 'Confirmed' WHERE id = ?`, [appointmentId]);
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

async function rejectAppointment(appointmentId, hospitalId, reason) {
    const appt = await loadForNotify(appointmentId, 'Pending', hospitalId);
    if (!appt) return null;

    await db.query(`UPDATE appointments SET status = 'Cancelled' WHERE id = ?`, [appointmentId]);
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
async function adminCancelAppointment(appointmentId, hospitalId, reason) {
    const params = [appointmentId];
    let where = "a.id = ? AND a.status != 'Cancelled'";
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

    await db.query(`UPDATE appointments SET status = 'Cancelled' WHERE id = ?`, [appointmentId]);
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
    adminCancelAppointment, deleteAppointment, deleteCancelledAppointments
};
