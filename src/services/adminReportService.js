const db = require('../config/db');
const adminStatsService = require('./adminStatsService');
const billingAdminService = require('./billingAdminService');
const appointmentAdminService = require('./appointmentAdminService');
const { formatDate } = require('../rule_engine/messages');

// Real report data (today's summary + full appointment list) — not decorative.
// Uses CURDATE() from the DB rather than a JS-computed date string, same
// reasoning as everywhere else in this project: a JS Date->ISO conversion has
// repeatedly shifted dates by a day in IST. Returns plain data; rendering
// (PDF) is a separate concern, done by pdfReportBuilder.js.
async function getTodayReportData(hospitalId) {
    const [[{ name: hospitalName }]] = await db.query('SELECT name FROM hospitals WHERE id = ?', [hospitalId]);
    const [[{ today }]] = await db.query('SELECT CURDATE() AS today');
    const todayStr = formatDate(today);

    const stats = await adminStatsService.getDashboardStats(hospitalId);
    const billing = await billingAdminService.getStats(hospitalId);
    const appointments = await appointmentAdminService.listAppointments(hospitalId, { date: todayStr });

    return { hospitalName, todayStr, stats, billing, appointments };
}

module.exports = { getTodayReportData };
