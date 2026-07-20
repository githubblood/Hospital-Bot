const db = require('../config/db');
const scheduleService = require('./scheduleService');
const { formatDate, cleanDoctorName } = require('../rule_engine/messages');

// All counts are scoped to one hospital via patients.hospital_id (appointments
// don't carry hospital_id directly, but every appointment's patient does).
async function getDashboardStats(hospitalId) {
    const [[todayRow]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.appointment_date = CURDATE() AND a.status != 'Cancelled'`,
        [hospitalId]
    );
    const [[pendingRow]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.status = 'Pending'`,
        [hospitalId]
    );
    const [[doctorsRow]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM doctors doc
         JOIN departments dep ON dep.id = doc.department_id
         JOIN branches b ON b.id = dep.branch_id
         WHERE b.hospital_id = ? AND doc.is_on_leave = FALSE`,
        [hospitalId]
    );
    const [[patientsRow]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM patients WHERE hospital_id = ?`,
        [hospitalId]
    );
    const [recent] = await db.query(
        `SELECT a.id, a.appointment_date, a.shift, a.token_number, a.status, a.payment_status,
                p.name AS patient_name, p.phone_number, doc.name AS doctor_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         WHERE p.hospital_id = ?
         ORDER BY a.created_at DESC
         LIMIT 10`,
        [hospitalId]
    );

    return {
        todayAppointments: todayRow.cnt,
        pendingApprovals: pendingRow.cnt,
        activeDoctors: doctorsRow.cnt,
        totalPatients: patientsRow.cnt,
        // JSON.stringify would serialize the DATE column's JS Date object via
        // toJSON() -> UTC ISO, shifting the date back a day in IST. Format to
        // a plain "YYYY-MM-DD" string server-side instead.
        recentAppointments: recent.map(r => ({
            ...r,
            appointment_date: formatDate(r.appointment_date),
            doctor_name: cleanDoctorName(r.doctor_name)
        }))
    };
}

// The 7 dashboard cards described in the UI/UX enhancement doc — all real
// counts, no placeholders. "Available Doctors Today" and "On Leave" need the
// doctor's own schedule_json (not a DB column), so those two are computed in
// JS via scheduleService rather than SQL — the exact same "does this doctor
// work today" check the booking flow itself uses.
async function getTodayOverview(hospitalId) {
    const [[byStatus]] = await db.query(
        `SELECT
            COUNT(*) AS total,
            SUM(a.status = 'Confirmed') AS confirmed,
            SUM(a.status = 'Cancelled') AS cancelled,
            SUM(a.status = 'Completed') AS completed,
            SUM(a.status IN ('Confirmed', 'Pending', 'Pending_Payment')) AS waiting
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.appointment_date = CURDATE()`,
        [hospitalId]
    );

    const [doctors] = await db.query(
        `SELECT doc.id, doc.is_on_leave, doc.schedule_json
         FROM doctors doc
         JOIN departments dep ON dep.id = doc.department_id
         JOIN branches b ON b.id = dep.branch_id
         WHERE b.hospital_id = ?`,
        [hospitalId]
    );
    const todayStr = formatDate(new Date());
    const onLeave = doctors.filter(d => d.is_on_leave).length;
    const availableToday = doctors.filter(d =>
        !d.is_on_leave && scheduleService.getAvailableShifts(d, todayStr).length > 0
    ).length;

    const [[patientsRow]] = await db.query('SELECT COUNT(*) AS cnt FROM patients WHERE hospital_id = ?', [hospitalId]);

    return {
        totalToday: byStatus.total,
        confirmedToday: Number(byStatus.confirmed) || 0,
        cancelledToday: Number(byStatus.cancelled) || 0,
        completedToday: Number(byStatus.completed) || 0,
        waitingToday: Number(byStatus.waiting) || 0,
        availableDoctorsToday: availableToday,
        doctorsOnLeave: onLeave,
        totalPatients: patientsRow.cnt
    };
}

// Real, hospital-scoped data for the 7 dashboard charts. "Reminder Success
// Rate" from the original ask is deliberately left out — WhatsApp sends here
// are fire-and-forget (see whatsappService.callGraphApi), so there's no
// delivery-receipt data to compute a real success rate from.
async function getChartsData(hospitalId) {
    const [perDay] = await db.query(
        `SELECT DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS d, COUNT(*) AS cnt
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.appointment_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 13 DAY) AND CURDATE()
         GROUP BY d ORDER BY d`,
        [hospitalId]
    );

    const [byDept] = await db.query(
        `SELECT dep.name_en AS department, COUNT(*) AS cnt
         FROM appointments a
         JOIN doctors doc ON doc.id = a.doctor_id
         JOIN departments dep ON dep.id = doc.department_id
         JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.status != 'Cancelled'
         GROUP BY dep.id ORDER BY cnt DESC`,
        [hospitalId]
    );

    const [doctorWorkload] = await db.query(
        `SELECT doc.name AS doctor, COUNT(*) AS cnt
         FROM appointments a
         JOIN doctors doc ON doc.id = a.doctor_id
         JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.status != 'Cancelled'
         GROUP BY doc.id ORDER BY cnt DESC LIMIT 10`,
        [hospitalId]
    );

    const [cancellationTrend] = await db.query(
        `SELECT DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS d,
                SUM(a.status = 'Cancelled') AS cancelled, COUNT(*) AS total
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.appointment_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 13 DAY) AND CURDATE()
         GROUP BY d ORDER BY d`,
        [hospitalId]
    );

    // "Booking hour" = when the booking was made (created_at), not the
    // appointment's own time slot — i.e. when patients tend to use the bot.
    const [peakHours] = await db.query(
        `SELECT HOUR(a.created_at) AS hr, COUNT(*) AS cnt
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ?
         GROUP BY hr ORDER BY hr`,
        [hospitalId]
    );

    const [queueByShift] = await db.query(
        `SELECT a.shift, COUNT(*) AS cnt
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.appointment_date = CURDATE() AND a.status != 'Cancelled'
         GROUP BY a.shift`,
        [hospitalId]
    );

    const [monthlyGrowth] = await db.query(
        `SELECT DATE_FORMAT(a.appointment_date, '%Y-%m') AS ym, COUNT(*) AS cnt
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.appointment_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
         GROUP BY ym ORDER BY ym`,
        [hospitalId]
    );

    return {
        appointmentsPerDay: perDay,
        appointmentsByDepartment: byDept,
        doctorWorkload: doctorWorkload.map(r => ({ ...r, doctor: cleanDoctorName(r.doctor) })),
        cancellationTrend: cancellationTrend.map(r => ({ d: r.d, cancelled: Number(r.cancelled), total: r.total })),
        peakBookingHours: peakHours,
        queueLoadByShift: queueByShift,
        monthlyGrowth: monthlyGrowth
    };
}

module.exports = { getDashboardStats, getTodayOverview, getChartsData };
