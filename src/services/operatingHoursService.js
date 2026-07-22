const db = require('../config/db');
const scheduleService = require('./scheduleService');
const appointmentAdminService = require('./appointmentAdminService');
const rescheduleService = require('./rescheduleService');
const scheduleAuditService = require('./scheduleAuditService');
const { formatDate, cleanDoctorName } = require('../rule_engine/messages');

const HOURS_FIELDS = ['morning_start', 'morning_end', 'afternoon_start', 'afternoon_end', 'evening_start', 'evening_end'];
const SHIFT_WINDOW = {
    Morning: ['morning_start', 'morning_end'],
    Afternoon: ['afternoon_start', 'afternoon_end'],
    Evening: ['evening_start', 'evening_end']
};

// mysql2 returns TIME columns as "HH:MM:SS"; the browser's <input type="time">
// sends "HH:MM" with no seconds. Normalizing both to "HH:MM" here means
// getOperatingHours' result and a freshly-submitted hours body are always
// directly comparable (used by the audit log's previous-vs-updated diff).
function normalizeHours(hours) {
    if (!hours) return hours;
    const out = {};
    for (const field of HOURS_FIELDS) out[field] = hours[field] ? String(hours[field]).slice(0, 5) : hours[field];
    return out;
}

async function getOperatingHours(hospitalId) {
    const [rows] = await db.query(
        `SELECT morning_start, morning_end, afternoon_start, afternoon_end, evening_start, evening_end
         FROM hospitals WHERE id = ?`,
        [hospitalId]
    );
    return normalizeHours(rows[0]) || null;
}

// Same string-error-or-null convention as scheduleService.validateSchedule.
function validateHours(hours) {
    if (!hours || typeof hours !== 'object') return 'Operating hours are required.';
    for (const field of HOURS_FIELDS) {
        if (typeof hours[field] !== 'string' || !hours[field]) {
            return `${field.replace('_', ' ')} is required.`;
        }
    }
    for (const [shift, [startField, endField]] of Object.entries(SHIFT_WINDOW)) {
        if (scheduleService.timeDiffMinutes(hours[startField], hours[endField]) <= 0) {
            return `${shift} end time must be after its start time.`;
        }
    }
    return null;
}

// Future, still-active appointments whose expected_time falls outside the
// NEW hours for their own shift — a direct hospital-hours-vs-appointment
// comparison, independent of doctors.schedule_json (which stays the sole
// authority for what a doctor can be booked for going forward; this only
// flags/handles appointments that already exist).
async function previewAffectedAppointments(hospitalId, newHours) {
    const byShift = { Morning: [], Afternoon: [], Evening: [] };
    for (const [shift, [startField, endField]] of Object.entries(SHIFT_WINDOW)) {
        const [rows] = await db.query(
            `SELECT a.id, a.patient_id, a.doctor_id, a.appointment_date, a.shift, a.expected_time, a.token_number,
                    p.name AS patient_name, p.phone_number, doc.name AS doctor_name
             FROM appointments a
             JOIN patients p ON p.id = a.patient_id
             JOIN doctors doc ON doc.id = a.doctor_id
             WHERE p.hospital_id = ? AND a.appointment_date >= CURRENT_DATE
               AND a.status IN ('Confirmed', 'Pending', 'Pending_Payment')
               AND a.shift = ? AND (a.expected_time < ? OR a.expected_time >= ?)
             ORDER BY a.appointment_date, a.expected_time`,
            [hospitalId, shift, newHours[startField], newHours[endField]]
        );
        byShift[shift] = rows.map(r => ({ ...r, appointment_date: formatDate(r.appointment_date), doctor_name: cleanDoctorName(r.doctor_name) }));
    }
    const totalCount = byShift.Morning.length + byShift.Afternoon.length + byShift.Evening.length;
    return { totalCount, byShift };
}

const ACTION_TO_AUDIT = {
    keep: 'KeepExisting',
    reschedule: 'Reschedule',
    cancel: 'CancelAppointments'
};

// action: 'keep' | 'reschedule' | 'cancel' | 'abort'.
async function saveOperatingHours(hospitalId, admin, newHours, action) {
    if (action === 'abort') {
        return { saved: false };
    }
    if (!ACTION_TO_AUDIT[action]) {
        return { error: `Invalid action "${action}".` };
    }

    const oldHours = await getOperatingHours(hospitalId);
    const affected = await previewAffectedAppointments(hospitalId, newHours);

    await db.query(
        `UPDATE hospitals SET morning_start=?, morning_end=?, afternoon_start=?, afternoon_end=?, evening_start=?, evening_end=?
         WHERE id = ?`,
        [newHours.morning_start, newHours.morning_end, newHours.afternoon_start, newHours.afternoon_end,
            newHours.evening_start, newHours.evening_end, hospitalId]
    );

    // Parallelized (Stage 3.5 perf review) — same reasoning as
    // scheduleController.createOverride: each iteration targets its own
    // appointment_id, and any same-doctor contention in the reschedule
    // branch is already serialized safely underneath by
    // bookingService.createAppointment's per-doctor lock.
    const allAffected = [...affected.byShift.Morning, ...affected.byShift.Afternoon, ...affected.byShift.Evening];
    if (action === 'cancel') {
        await Promise.all(allAffected.map(appt =>
            appointmentAdminService.adminCancelAppointment(appt.id, hospitalId, 'Operating hours changed', admin.id)
        ));
    } else if (action === 'reschedule') {
        await Promise.all(allAffected.map(appt =>
            rescheduleService.autoRescheduleAppointment(appt, hospitalId, 'a change in operating hours', admin.id)
        ));
    }

    await scheduleAuditService.record({
        hospitalId, adminId: admin.id, adminName: admin.name,
        changeType: 'OperatingHours', previousHours: oldHours, updatedHours: normalizeHours(newHours),
        affectedCount: affected.totalCount, actionTaken: ACTION_TO_AUDIT[action]
    });

    return { saved: true, affectedCount: affected.totalCount, action };
}

module.exports = { getOperatingHours, validateHours, previewAffectedAppointments, saveOperatingHours };
