const db = require('../config/db');
const whatsappService = require('./whatsappService');
const { bi, cleanDoctorName, formatTime } = require('../rule_engine/messages');

const SCAN_INTERVAL_MS = 15 * 60 * 1000;
const REMINDER_WINDOW_MINUTES = 120;

let intervalHandle = null;

// Scans for today's Confirmed, not-yet-reminded appointments starting within
// the next two hours, and sends each patient a WhatsApp nudge. Follows this
// codebase's existing best-effort convention for outbound sends — see
// whatsappService.callGraphApi, which already logs and swallows its own
// errors rather than throwing — so a failed send still gets reminder_sent
// set. That mirrors every other WhatsApp notification in this project
// (appointmentAdminService, adminController, billingAdminService); a genuine
// delivery-retry mechanism would need its own tracking and isn't part of
// what's requested here.
async function sendDueReminders() {
    const [rows] = await db.query(
        `SELECT a.id, a.token_number, a.expected_time,
                doc.name AS doctor_name,
                p.phone_number,
                h.whatsapp_business_phone_id, h.whatsapp_access_token
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         JOIN hospitals h ON h.id = p.hospital_id
         WHERE a.appointment_date = CURDATE()
           AND a.status = 'Confirmed'
           AND a.reminder_sent = FALSE
           AND TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(a.appointment_date, a.expected_time)) BETWEEN 0 AND ?`,
        [REMINDER_WINDOW_MINUTES]
    );

    for (const appt of rows) {
        const dn = cleanDoctorName(appt.doctor_name);
        const t = formatTime(appt.expected_time);
        const hospital = {
            whatsapp_business_phone_id: appt.whatsapp_business_phone_id,
            whatsapp_access_token: appt.whatsapp_access_token
        };

        await whatsappService.sendText(
            hospital,
            appt.phone_number,
            bi(
                `⏰ Reminder: your appointment with Dr. ${dn} is coming up today at ${t}. Token #${appt.token_number}. Please try to arrive a little early.`,
                `⏰ याद दिलाना: डॉ. ${dn} के साथ आपकी अपॉइंटमेंट आज ${t} बजे है। टोकन #${appt.token_number}। कृपया थोड़ा जल्दी पहुँचने की कोशिश करें।`
            )
        );
        await db.query('UPDATE appointments SET reminder_sent = TRUE, reminder_sent_at = NOW() WHERE id = ?', [appt.id]);
    }

    return rows.length;
}

// Idempotent — calling start() again while already running is a no-op, so
// it's safe to call unconditionally at boot without tracking state elsewhere.
function start() {
    if (intervalHandle) return;

    sendDueReminders().catch(err => console.error('Reminder scan failed:', err.message));
    intervalHandle = setInterval(() => {
        sendDueReminders().catch(err => console.error('Reminder scan failed:', err.message));
    }, SCAN_INTERVAL_MS);
}

function stop() {
    clearInterval(intervalHandle);
    intervalHandle = null;
}

module.exports = { start, stop, sendDueReminders };
