const db = require('../../config/db');

// Maps the inbound webhook's metadata.phone_number_id to the tenant hospital row.
async function resolveHospitalByPhoneNumberId(phoneNumberId) {
    const [rows] = await db.query('SELECT * FROM hospitals WHERE whatsapp_business_phone_id = ?', [phoneNumberId]);
    return rows[0] || null;
}

async function getHospitalConfig(hospitalId) {
    const [rows] = await db.query('SELECT * FROM hospitals WHERE id = ?', [hospitalId]);
    return rows[0] || null;
}

module.exports = { resolveHospitalByPhoneNumberId, getHospitalConfig };
