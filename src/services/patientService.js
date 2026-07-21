const db = require('../config/db');

// "Primary" patient for the handful of call sites that were built before
// family members could share a phone number (My Appointments, Live Queue
// Status, self-service cancel) and still only handle one patient — this
// resolves that ambiguity deterministically as the first-ever registered
// row under this phone, not an arbitrary one. Multi-patient-aware flows
// (booking) use findPatientsByPhone/getPatientById instead — see
// patientSelector.js.
async function findPatient(hospitalId, phoneNumber) {
    const [rows] = await db.query(
        'SELECT * FROM patients WHERE hospital_id = ? AND phone_number = ? ORDER BY id ASC LIMIT 1',
        [hospitalId, phoneNumber]
    );
    return rows[0] || null;
}

// Every family member registered under this phone number, oldest first —
// powers the "Who is the appointment for?" choice at the start of booking
// (patientSelector.js).
async function findPatientsByPhone(hospitalId, phoneNumber) {
    const [rows] = await db.query(
        'SELECT * FROM patients WHERE hospital_id = ? AND phone_number = ? ORDER BY id ASC',
        [hospitalId, phoneNumber]
    );
    return rows;
}

async function getPatientById(patientId) {
    const [rows] = await db.query('SELECT * FROM patients WHERE id = ?', [patientId]);
    return rows[0] || null;
}

// UHID is generated here — the one function both the WhatsApp bot's
// registration flow and Reception's patient creation call — so there is
// exactly one place a patient's identifier is ever assigned, never two
// generation paths that could drift or collide. Needs the row's own
// auto-increment id first, hence the second UPDATE rather than a single INSERT.
async function createPatient(hospitalId, phoneNumber, name, age, gender) {
    const [result] = await db.query(
        'INSERT INTO patients (hospital_id, phone_number, name, age, gender) VALUES (?, ?, ?, ?, ?)',
        [hospitalId, phoneNumber, name, age, gender]
    );
    const uhid = 'UH' + String(result.insertId).padStart(6, '0');
    await db.query('UPDATE patients SET uhid = ? WHERE id = ?', [uhid, result.insertId]);
    return { id: result.insertId, uhid, hospital_id: hospitalId, phone_number: phoneNumber, name, age, gender };
}

module.exports = { findPatient, findPatientsByPhone, getPatientById, createPatient };
