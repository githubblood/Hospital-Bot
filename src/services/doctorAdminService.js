const db = require('../config/db');
const catalogService = require('./catalogService');
const { cleanDoctorName } = require('../rule_engine/messages');

// Names are shown cleaned everywhere in the admin panel (some seed data has
// "Dr." baked into the stored name, which would double up as "Dr. Dr. X" —
// same bug class fixed in the chatbot's messages layer). Create/update store
// whatever the form submits verbatim, so admin-entered names stay clean going
// forward without the panel silently rewriting data.
// Includes real per-doctor counts (distinct patients seen, total bookings) —
// used by the doctor-card stats in the admin panel. No rating/experience
// fields exist anywhere in the schema, so the panel doesn't display any;
// these two counts are the genuine numbers available.
async function listDoctors(hospitalId, search) {
    const params = [hospitalId];
    let where = 'b.hospital_id = ?';
    if (search) {
        where += ' AND doc.name LIKE ?';
        params.push(`%${search}%`);
    }

    const [rows] = await db.query(
        `SELECT doc.id, doc.department_id, doc.name, doc.qualification, doc.experience_years,
                doc.is_on_leave, doc.consultation_fee, doc.schedule_json,
                dep.name_en AS department_name,
                COUNT(DISTINCT a.patient_id) AS patient_count,
                COUNT(a.id) AS appointment_count
         FROM doctors doc
         JOIN departments dep ON dep.id = doc.department_id
         JOIN branches b ON b.id = dep.branch_id
         LEFT JOIN appointments a ON a.doctor_id = doc.id
         WHERE ${where}
         GROUP BY doc.id
         ORDER BY dep.id, doc.id`,
        params
    );
    return rows.map(r => ({ ...r, name: cleanDoctorName(r.name), schedule_json: JSON.parse(r.schedule_json) }));
}

// Ownership-checked single-doctor lookup — only returns a row if the doctor
// belongs to this hospital, so one hospital's admin can't read/edit another's.
async function getDoctor(hospitalId, doctorId) {
    const [rows] = await db.query(
        `SELECT doc.id, doc.department_id, doc.name, doc.qualification, doc.experience_years,
                doc.is_on_leave, doc.consultation_fee, doc.schedule_json,
                dep.name_en AS department_name
         FROM doctors doc
         JOIN departments dep ON dep.id = doc.department_id
         JOIN branches b ON b.id = dep.branch_id
         WHERE doc.id = ? AND b.hospital_id = ?`,
        [doctorId, hospitalId]
    );
    if (!rows[0]) return null;
    return { ...rows[0], name: cleanDoctorName(rows[0].name), schedule_json: JSON.parse(rows[0].schedule_json) };
}

async function createDoctor(hospitalId, { department_id, name, qualification, experience_years, consultation_fee, schedule_json, is_on_leave }) {
    const owns = await catalogService.departmentBelongsToHospital(department_id, hospitalId);
    if (!owns) return { error: 'DEPARTMENT_NOT_FOUND' };

    const [result] = await db.query(
        `INSERT INTO doctors (department_id, name, qualification, experience_years, consultation_fee, schedule_json, is_on_leave)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [department_id, name, qualification || null, experience_years != null ? experience_years : 0, consultation_fee, JSON.stringify(schedule_json), !!is_on_leave]
    );
    return { id: result.insertId };
}

async function updateDoctor(hospitalId, doctorId, { department_id, name, qualification, experience_years, consultation_fee, schedule_json, is_on_leave }) {
    const existing = await getDoctor(hospitalId, doctorId);
    if (!existing) return { error: 'NOT_FOUND' };

    if (department_id && department_id !== existing.department_id) {
        const owns = await catalogService.departmentBelongsToHospital(department_id, hospitalId);
        if (!owns) return { error: 'DEPARTMENT_NOT_FOUND' };
    }

    await db.query(
        `UPDATE doctors SET department_id = ?, name = ?, qualification = ?, experience_years = ?, consultation_fee = ?, schedule_json = ?, is_on_leave = ? WHERE id = ?`,
        [
            department_id || existing.department_id,
            name || existing.name,
            qualification !== undefined ? (qualification || null) : existing.qualification,
            experience_years != null ? experience_years : existing.experience_years,
            consultation_fee != null ? consultation_fee : existing.consultation_fee,
            JSON.stringify(schedule_json || existing.schedule_json),
            is_on_leave != null ? !!is_on_leave : existing.is_on_leave,
            doctorId
        ]
    );
    return { id: Number(doctorId) };
}

async function toggleLeave(hospitalId, doctorId) {
    const existing = await getDoctor(hospitalId, doctorId);
    if (!existing) return null;

    const newValue = !existing.is_on_leave;
    await db.query('UPDATE doctors SET is_on_leave = ? WHERE id = ?', [newValue, doctorId]);
    return { id: Number(doctorId), is_on_leave: newValue };
}

// Deleting a doctor CASCADEs to their appointments (schema FK), which would
// silently destroy real appointment/patient history. Block the delete instead
// when any appointments exist and point staff at "mark as on leave" — the
// non-destructive alternative — rather than a Doctor row someone can't undo.
async function deleteDoctor(hospitalId, doctorId) {
    const existing = await getDoctor(hospitalId, doctorId);
    if (!existing) return { error: 'NOT_FOUND' };

    const [[{ cnt }]] = await db.query('SELECT COUNT(*) AS cnt FROM appointments WHERE doctor_id = ?', [doctorId]);
    if (cnt > 0) {
        return { error: 'HAS_APPOINTMENTS', appointmentCount: cnt };
    }

    await db.query('DELETE FROM doctors WHERE id = ?', [doctorId]);
    return { deleted: true };
}

module.exports = { listDoctors, getDoctor, createDoctor, updateDoctor, toggleLeave, deleteDoctor };
