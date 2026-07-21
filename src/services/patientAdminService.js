const db = require('../config/db');
const { cleanDoctorName, formatDate } = require('../rule_engine/messages');

// Safety cap (Stage 3.5 perf review), same reasoning as
// appointmentAdminService's MAX_RESULTS — this query had no LIMIT at all.
const MAX_RESULTS = 1000;

async function listPatients(hospitalId, search) {
    const params = [hospitalId];
    let where = 'p.hospital_id = ?';
    if (search) {
        where += ' AND (p.name LIKE ? OR p.phone_number LIKE ? OR p.uhid LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
        `SELECT p.id, p.uhid, p.name, p.phone_number, p.age, p.gender, p.created_at,
                COUNT(a.id) AS appointment_count
         FROM patients p
         LEFT JOIN appointments a ON a.patient_id = p.id
         WHERE ${where}
         GROUP BY p.id
         ORDER BY p.created_at DESC
         LIMIT ?`,
        [...params, MAX_RESULTS]
    );
    return rows;
}

// Ownership-checked: only returns the patient (and their history) if they
// belong to this hospital.
async function getPatientWithHistory(hospitalId, patientId) {
    const [patRows] = await db.query(
        'SELECT id, name, phone_number, age, gender, created_at FROM patients WHERE id = ? AND hospital_id = ?',
        [patientId, hospitalId]
    );
    if (!patRows[0]) return null;

    const [history] = await db.query(
        `SELECT a.id, a.appointment_date, a.shift, a.token_number, a.status, a.payment_status, doc.name AS doctor_name
         FROM appointments a
         JOIN doctors doc ON doc.id = a.doctor_id
         WHERE a.patient_id = ?
         ORDER BY a.appointment_date DESC, a.expected_time DESC`,
        [patientId]
    );

    return {
        ...patRows[0],
        history: history.map(h => ({ ...h, appointment_date: formatDate(h.appointment_date), doctor_name: cleanDoctorName(h.doctor_name) }))
    };
}

module.exports = { listPatients, getPatientWithHistory };
