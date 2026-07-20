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

async function createPatient(hospitalId, phoneNumber, name, age, gender) {
    const [result] = await db.query(
        'INSERT INTO patients (hospital_id, phone_number, name, age, gender) VALUES (?, ?, ?, ?, ?)',
        [hospitalId, phoneNumber, name, age, gender]
    );
    return { id: result.insertId, hospital_id: hospitalId, phone_number: phoneNumber, name, age, gender };
}

module.exports = { findPatient, findPatientsByPhone, getPatientById, createPatient };
