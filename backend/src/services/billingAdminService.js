const db = require('../config/db');
const whatsappService = require('./whatsappService');
const { bi, cleanDoctorName, formatDate, formatDateDisplay } = require('../webhook/messages');

// Safety cap (Stage 3.5 perf review), same reasoning as
// appointmentAdminService's MAX_RESULTS — this query had no LIMIT at all.
const MAX_RESULTS = 1000;

async function getStats(hospitalId) {
    const [[todayRow]] = await db.query(
        `SELECT COALESCE(SUM(b.total_amount), 0) AS collection, COUNT(*) AS total
         FROM bills b JOIN patients p ON p.id = b.patient_id
         WHERE p.hospital_id = ? AND b.bill_date = CURRENT_DATE AND b.payment_status = 'Paid'`,
        [hospitalId]
    );
    const [[totalTodayRow]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM bills b JOIN patients p ON p.id = b.patient_id
         WHERE p.hospital_id = ? AND b.bill_date = CURRENT_DATE`,
        [hospitalId]
    );
    const [[unpaidRow]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM bills b JOIN patients p ON p.id = b.patient_id
         WHERE p.hospital_id = ? AND b.payment_status IN ('Unpaid', 'Partial')`,
        [hospitalId]
    );
    const [[monthRow]] = await db.query(
        `SELECT COALESCE(SUM(b.total_amount), 0) AS collection FROM bills b JOIN patients p ON p.id = b.patient_id
         WHERE p.hospital_id = ? AND b.payment_status = 'Paid'
               AND b.bill_date >= DATE_TRUNC('month', CURRENT_DATE)`,
        [hospitalId]
    );

    return {
        today_collection: Number(todayRow.collection),
        today_total: totalTodayRow.cnt,
        unpaid_count: unpaidRow.cnt,
        month_collection: Number(monthRow.collection)
    };
}

async function listBills(hospitalId, { date, status, search } = {}) {
    const params = [hospitalId];
    let where = 'p.hospital_id = ?';
    if (date) { where += ' AND b.bill_date = ?'; params.push(date); }
    if (status) { where += ' AND b.payment_status = ?'; params.push(status); }
    if (search) {
        where += ' AND (p.name ILIKE ? OR p.phone_number ILIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
        `SELECT b.id, b.total_amount, b.payment_method, b.payment_status, b.bill_date,
                p.name AS patient_name, p.phone_number, doc.name AS doctor_name
         FROM bills b
         JOIN patients p ON p.id = b.patient_id
         JOIN doctors doc ON doc.id = b.doctor_id
         WHERE ${where}
         ORDER BY b.created_at DESC
         LIMIT ?`,
        [...params, MAX_RESULTS]
    );
    return rows.map(r => ({ ...r, bill_date: formatDate(r.bill_date), doctor_name: cleanDoctorName(r.doctor_name) }));
}

async function getBillById(hospitalId, billId) {
    const [rows] = await db.query(
        `SELECT b.*, p.name AS patient_name, p.phone_number, doc.name AS doctor_name
         FROM bills b
         JOIN patients p ON p.id = b.patient_id
         JOIN doctors doc ON doc.id = b.doctor_id
         WHERE b.id = ? AND p.hospital_id = ?`,
        [billId, hospitalId]
    );
    if (!rows[0]) return null;
    return { ...rows[0], bill_date: formatDate(rows[0].bill_date), doctor_name: cleanDoctorName(rows[0].doctor_name) };
}

// Appointments for a patient that don't have a bill yet — populates the "New
// Bill" modal's appointment dropdown once a patient is chosen.
async function getUnbilledAppointments(hospitalId, patientId) {
    const [rows] = await db.query(
        `SELECT a.id, a.appointment_date, a.shift, a.token_number, doc.name AS doctor_name, doc.consultation_fee
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         LEFT JOIN bills b ON b.appointment_id = a.id
         WHERE a.patient_id = ? AND p.hospital_id = ? AND b.id IS NULL AND a.status != 'Cancelled'
         ORDER BY a.appointment_date DESC`,
        [patientId, hospitalId]
    );
    return rows.map(r => ({ ...r, appointment_date: formatDate(r.appointment_date), doctor_name: cleanDoctorName(r.doctor_name) }));
}

function computeTotal({ consultation_fee = 0, medicine_charges = 0, test_charges = 0, other_charges = 0, discount = 0 }) {
    const total = Number(consultation_fee) + Number(medicine_charges) + Number(test_charges) + Number(other_charges) - Number(discount);
    return Math.max(0, Math.round(total * 100) / 100);
}

async function createBill(hospitalId, body) {
    const { appointment_id, consultation_fee, medicine_charges, test_charges, other_charges, discount, payment_method, payment_status, notes } = body;

    const [apptRows] = await db.query(
        `SELECT a.id, a.patient_id, a.doctor_id FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.id = ? AND p.hospital_id = ?`,
        [appointment_id, hospitalId]
    );
    const appt = apptRows[0];
    if (!appt) return { error: 'APPOINTMENT_NOT_FOUND' };

    const total = computeTotal({ consultation_fee, medicine_charges, test_charges, other_charges, discount });
    const status = payment_status || 'Unpaid';

    try {
        const [result] = await db.query(
            `INSERT INTO bills
             (appointment_id, patient_id, doctor_id, consultation_fee, medicine_charges, test_charges, other_charges,
              discount, total_amount, payment_method, payment_status, bill_date, paid_at, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE, ?, ?)`,
            [
                appointment_id, appt.patient_id, appt.doctor_id,
                consultation_fee || 0, medicine_charges || 0, test_charges || 0, other_charges || 0, discount || 0,
                total, payment_method || 'Cash', status,
                status === 'Paid' ? new Date() : null,
                notes || null
            ]
        );
        return { id: result.insertId };
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return { error: 'ALREADY_BILLED' };
        throw err;
    }
}

async function markPaid(hospitalId, billId) {
    const bill = await getBillById(hospitalId, billId);
    if (!bill) return null;

    await db.query(`UPDATE bills SET payment_status = 'Paid', paid_at = NOW() WHERE id = ?`, [billId]);
    return { id: Number(billId), payment_status: 'Paid' };
}

async function sendBillWhatsApp(hospitalId, billId) {
    const [rows] = await db.query(
        `SELECT b.*, p.phone_number, doc.name AS doctor_name,
                h.whatsapp_business_phone_id, h.whatsapp_access_token
         FROM bills b
         JOIN patients p ON p.id = b.patient_id
         JOIN doctors doc ON doc.id = b.doctor_id
         JOIN hospitals h ON h.id = p.hospital_id
         WHERE b.id = ? AND p.hospital_id = ?`,
        [billId, hospitalId]
    );
    const bill = rows[0];
    if (!bill) return null;

    const dn = cleanDoctorName(bill.doctor_name);
    const date = formatDateDisplay(bill.bill_date);
    const message = bi(
        `🧾 Bill #${bill.id} — Dr. ${dn}\nDate: ${date}\n\nConsultation: ₹${bill.consultation_fee}\nMedicine: ₹${bill.medicine_charges}\nTests: ₹${bill.test_charges}\nOther: ₹${bill.other_charges}\nDiscount: -₹${bill.discount}\n\n*Total: ₹${bill.total_amount}*\nStatus: ${bill.payment_status}`,
        `🧾 बिल #${bill.id} — डॉ. ${dn}\nतारीख: ${date}\n\nपरामर्श: ₹${bill.consultation_fee}\nदवाई: ₹${bill.medicine_charges}\nजांच: ₹${bill.test_charges}\nअन्य: ₹${bill.other_charges}\nछूट: -₹${bill.discount}\n\n*कुल: ₹${bill.total_amount}*\nस्थिति: ${bill.payment_status}`
    );

    await whatsappService.sendText(
        { whatsapp_business_phone_id: bill.whatsapp_business_phone_id, whatsapp_access_token: bill.whatsapp_access_token },
        bill.phone_number,
        message
    );
    return { success: true };
}

module.exports = { getStats, listBills, getBillById, getUnbilledAppointments, createBill, markPaid, sendBillWhatsApp };
