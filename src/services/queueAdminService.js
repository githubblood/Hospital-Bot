const db = require('../config/db');
const doctorAdminService = require('./doctorAdminService');
const whatsappService = require('./whatsappService');
const queueBroadcastService = require('./queueBroadcastService');
const scheduleService = require('./scheduleService');
const appointmentStateMachine = require('./appointmentStateMachine');
const { bi, formatTime } = require('../rule_engine/messages');

// Ownership check reused everywhere below: a hospital's staff can only poll/
// advance the queue for their own doctors. Uses CURDATE() in SQL throughout
// rather than a JS-computed date string — a JS Date->ISO conversion shifted
// dates by a day in IST more than once earlier in this project; SQL's own
// server-local CURDATE() sidesteps that class of bug entirely here.
async function assertDoctorOwnership(hospitalId, doctorId) {
    const doctor = await doctorAdminService.getDoctor(hospitalId, doctorId);
    return doctor; // null if not found / not owned by this hospital
}

async function getTodayQueue(hospitalId, doctorId, shift) {
    const doctor = await assertDoctorOwnership(hospitalId, doctorId);
    if (!doctor) return null;

    const [rows] = await db.query(
        `SELECT a.id, a.token_number, a.expected_time, a.status, a.completed_at,
                p.name AS patient_name, p.phone_number, p.age, p.gender
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.doctor_id = ? AND a.appointment_date = CURDATE() AND a.shift = ?
               AND a.status != 'Cancelled'
         ORDER BY a.token_number ASC`,
        [doctorId, shift]
    );

    const queue = rows.map(r => ({ ...r, expected_time: formatTime(r.expected_time) }));
    const active = queue.filter(a => a.status !== 'Completed');
    const current = active[0] || null;
    const next = active[1] || null;

    return {
        doctor: { id: doctor.id, name: doctor.name, department_name: doctor.department_name },
        current_token: current?.token_number ?? null,
        current_patient: current,
        next_token: next?.token_number ?? null,
        next_patient: next,
        seen_count: queue.length - active.length,
        remaining_count: active.length,
        total_count: queue.length,
        queue
    };
}

async function getLiveStats(hospitalId, doctorId, shift) {
    const doctor = await assertDoctorOwnership(hospitalId, doctorId);
    if (!doctor) return null;

    const [[stats]] = await db.query(
        `SELECT
            COUNT(*) AS total,
            SUM(status = 'Completed') AS seen,
            MIN(CASE WHEN status NOT IN ('Completed', 'Cancelled') THEN token_number END) AS current_token
         FROM appointments
         WHERE doctor_id = ? AND appointment_date = CURDATE() AND shift = ? AND status != 'Cancelled'`,
        [doctorId, shift]
    );

    const seen = Number(stats.seen) || 0;
    return {
        current_token: stats.current_token,
        seen_count: seen,
        remaining_count: stats.total - seen,
        total_count: stats.total,
        last_updated: new Date().toISOString()
    };
}

// Recomputes the live queue and pushes it to any admin dashboards currently
// watching this doctor/shift's SSE stream. Safe to call for a doctor/shift
// with no watchers — queueBroadcastService.broadcast is then just a no-op.
async function broadcastQueueUpdate(hospitalId, doctorId, shift) {
    const data = await getTodayQueue(hospitalId, doctorId, shift);
    if (data) queueBroadcastService.broadcast(hospitalId, doctorId, shift, data);
}

// Marks the given appointment Completed, then looks up whoever is now next in
// that doctor/date/shift queue and sends them a bilingual "your turn" nudge —
// the optional WhatsApp step from the spec, built in rather than left out
// since the messaging plumbing (whatsappService + bilingual bi()) already exists.
async function markCurrentDone(hospitalId, appointmentId, adminId) {
    const [rows] = await db.query(
        `SELECT a.*, p.hospital_id
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.id = ? AND p.hospital_id = ?`,
        [appointmentId, hospitalId]
    );
    const appt = rows[0];
    if (!appt) return null;

    // checkin_status also moves to 'In Consultation' here if it hadn't
    // already — completing via Queue Management (not Reception's own
    // check-in controls) shouldn't leave the Reception timeline showing the
    // patient as still merely "Waiting" for an appointment that's now done.
    // Only 'Confirmed' is actually allowed to become 'Completed' (see
    // appointmentStateMachine's transition map) — the old WHERE here only
    // ever excluded exactly Completed/Cancelled, meaning a Pending/
    // Pending_Payment/Waitlisted/No-Show row could previously be "completed"
    // by mistake via a stray queue-advance call. That's now correctly
    // rejected instead.
    const transition = await appointmentStateMachine.transitionStatus(appointmentId, 'Completed', {
        adminId, extraFields: { completed_at: new Date(), checkin_status: 'In Consultation' }
    });
    if (transition.error) return null;

    const [nextRows] = await db.query(
        `SELECT a.id, a.token_number, p.phone_number, doc.name AS doctor_name,
                h.whatsapp_business_phone_id, h.whatsapp_access_token
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors doc ON doc.id = a.doctor_id
         JOIN hospitals h ON h.id = p.hospital_id
         WHERE a.doctor_id = ? AND a.appointment_date = CURDATE() AND a.shift = ?
               AND a.status NOT IN ('Completed', 'Cancelled')
         ORDER BY a.token_number ASC LIMIT 1`,
        [appt.doctor_id, appt.shift]
    );

    let notified = null;
    const next = nextRows[0];
    if (next) {
        await whatsappService.sendText(
            { whatsapp_business_phone_id: next.whatsapp_business_phone_id, whatsapp_access_token: next.whatsapp_access_token },
            next.phone_number,
            bi(
                `🔔 It's almost your turn! Token #${next.token_number} with Dr. ${next.doctor_name} — please head to the clinic now.`,
                `🔔 आपकी बारी आने वाली है! टोकन #${next.token_number}, डॉ. ${next.doctor_name} — कृपया अभी क्लिनिक आएँ।`
            )
        );
        notified = { appointmentId: next.id, tokenNumber: next.token_number };
    }

    await broadcastQueueUpdate(hospitalId, appt.doctor_id, appt.shift);

    return { completedAppointmentId: Number(appointmentId), notifiedNext: notified };
}

// Every doctor+shift that has at least one appointment on the given date, for
// the new Queue Management page (one row per doctor/shift, not per patient —
// getTodayQueue above is the per-patient drill-down for a single doctor/shift).
async function getAllQueuesForDate(hospitalId, date) {
    const [rows] = await db.query(
        `SELECT a.doctor_id, doc.name AS doctor_name, doc.schedule_json, dep.name_en AS department_name,
                a.shift, a.id, a.token_number, a.status
         FROM appointments a
         JOIN doctors doc ON doc.id = a.doctor_id
         JOIN departments dep ON dep.id = doc.department_id
         JOIN branches b ON b.id = dep.branch_id
         WHERE b.hospital_id = ? AND a.appointment_date = ?
         ORDER BY doc.id, a.shift, a.token_number ASC`,
        [hospitalId, date]
    );

    const groups = new Map();
    for (const r of rows) {
        const key = `${r.doctor_id}_${r.shift}`;
        if (!groups.has(key)) {
            groups.set(key, {
                doctor_id: r.doctor_id, doctor_name: r.doctor_name, schedule_json: r.schedule_json,
                department_name: r.department_name, shift: r.shift, tokens: []
            });
        }
        groups.get(key).tokens.push({ id: r.id, token_number: r.token_number, status: r.status });
    }

    return Array.from(groups.values()).map(g => {
        const active = g.tokens.filter(t => t.status !== 'Completed' && t.status !== 'Cancelled');
        const completed = g.tokens.filter(t => t.status === 'Completed').length;
        const cancelled = g.tokens.filter(t => t.status === 'Cancelled').length;
        const current = active[0] || null;
        const next = active[1] || null;

        const shiftWindow = scheduleService.getShiftWindow({ schedule_json: g.schedule_json }, date, g.shift);
        const avgConsultMins = shiftWindow
            ? Math.max(1, Math.round(scheduleService.timeDiffMinutes(shiftWindow.start, shiftWindow.end) / shiftWindow.max_tokens))
            : 15;

        return {
            doctor_id: g.doctor_id,
            doctor_name: g.doctor_name,
            department_name: g.department_name,
            shift: g.shift,
            current_token: current?.token_number ?? null,
            current_appointment_id: current?.id ?? null,
            next_token: next?.token_number ?? null,
            patients_waiting: active.length,
            completed_count: completed,
            cancelled_count: cancelled,
            estimated_wait_mins: active.length * avgConsultMins
        };
    });
}

module.exports = { getTodayQueue, getLiveStats, markCurrentDone, broadcastQueueUpdate, getAllQueuesForDate };
