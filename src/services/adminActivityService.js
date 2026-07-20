const db = require('../config/db');
const { cleanDoctorName } = require('../rule_engine/messages');

// Real recent-activity feed (new patient registrations + new bookings),
// standing in for the reference design's notification panel — with actual
// events instead of invented ones like "Lab Results Ready".
async function getRecentActivity(hospitalId, limit = 8) {
    const [patients] = await db.query(
        `SELECT id, name, created_at FROM patients WHERE hospital_id = ? ORDER BY created_at DESC LIMIT ?`,
        [hospitalId, limit]
    );
    const [appointments] = await db.query(
        `SELECT a.id, a.created_at, a.status, p.name AS patient_name, doc.name AS doctor_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         WHERE p.hospital_id = ?
         ORDER BY a.created_at DESC LIMIT ?`,
        [hospitalId, limit]
    );

    const events = [
        ...patients.map(p => ({
            type: 'patient',
            text: `${p.name} registered as a new patient`,
            time: p.created_at
        })),
        ...appointments.map(a => ({
            type: 'appointment',
            text: `${a.patient_name} booked with Dr. ${cleanDoctorName(a.doctor_name)} (${a.status})`,
            time: a.created_at
        }))
    ];

    events.sort((a, b) => new Date(b.time) - new Date(a.time));
    return events.slice(0, limit);
}

module.exports = { getRecentActivity };
