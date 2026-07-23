const receptionAdminService = require('../services/receptionAdminService');
const appointmentAdminService = require('../services/appointmentAdminService');
const db = require('../config/db');

exports.getDashboard = async (req, res) => {
    const date = req.query.date || null;
    // DATE_FORMAT, not a bare CURDATE() — mysql2 returns DATE columns as JS
    // Date objects, and passing that object through to date-string-expecting
    // functions (scheduleService.getShiftWindow does `${dateStr}T00:00:00`)
    // silently produces an Invalid Date deep inside, not an error at this
    // call site — the exact IST/timezone bug class this project has hit
    // before. A pre-formatted string sidesteps it entirely.
    const [[{ today }]] = await db.query("SELECT TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') AS today");
    const stats = await receptionAdminService.getDashboardStats(req.admin.hospital_id, date || today);
    res.json(stats);
};

// Full search: name/phone/UHID (search), appointment id, doctor, department,
// date, status — reuses appointmentAdminService.listAppointments (the exact
// same function/query the existing Appointments admin page already uses),
// not a second search implementation.
exports.searchAppointments = async (req, res) => {
    const { search, appointmentId, doctorId, departmentId, date, status } = req.query;
    const appointments = await appointmentAdminService.listAppointments(req.admin.hospital_id, {
        search, appointmentId, doctorId, departmentId, date, status
    });
    res.json({ appointments });
};

function validateBookingBody(body) {
    if (!body.doctorId || !body.date || !body.shift) {
        return 'doctorId, date, and shift are all required';
    }
    if (!body.patientId && !body.newPatient) {
        return 'Either patientId or newPatient is required';
    }
    if (body.newPatient && (!body.newPatient.name || !body.newPatient.phone || !body.newPatient.age || !body.newPatient.gender)) {
        return 'newPatient requires name, phone, age, and gender';
    }
    return null;
}

function mapCreateError(result) {
    if (result.error === 'PATIENT_NOT_FOUND') return { status: 404, body: { error: 'Patient not found' } };
    if (result.error === 'PATIENT_REQUIRED') return { status: 400, body: { error: 'Either patientId or newPatient is required' } };
    if (result.error === 'DOCTOR_NOT_FOUND') return { status: 404, body: { error: 'Doctor not found' } };
    if (result.error === 'DUPLICATE_BOOKING') return { status: 409, body: { error: 'This patient already has an active appointment with this doctor on this date' } };
    if (result.error === 'PAST_DATE') return { status: 400, body: { error: 'Cannot book an appointment for a past date' } };
    if (result.error === 'HOSPITAL_SUSPENDED') return { status: 403, body: { error: 'This hospital account has been suspended. Please contact support.' } };
    if (result.error === 'SLOT_UNAVAILABLE') return { status: 409, body: { error: 'That slot is not available', reason: result.reason } };
    return null;
}

// Manual Appointment Booking — a scheduled booking made on the patient's
// behalf, any valid date the doctor works.
exports.createAppointment = async (req, res) => {
    const body = req.body || {};
    const validationError = validateBookingBody(body);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = await receptionAdminService.createReceptionAppointment(req.admin.hospital_id, req.admin.id, {
        ...body, source: 'Reception'
    });
    const mapped = mapCreateError(result);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    res.status(201).json({ success: true, ...result });
};

// Walk-in Registration — date is always today, forced server-side (a walk-in
// is, by definition, someone physically at the hospital right now), and the
// patient is checked in immediately regardless of what the client sends.
exports.createWalkIn = async (req, res) => {
    const body = req.body || {};
    if (!body.doctorId || !body.shift) {
        return res.status(400).json({ error: 'doctorId and shift are required' });
    }
    if (!body.patientId && !body.newPatient) {
        return res.status(400).json({ error: 'Either patientId or newPatient is required' });
    }
    if (body.newPatient && (!body.newPatient.name || !body.newPatient.phone || !body.newPatient.age || !body.newPatient.gender)) {
        return res.status(400).json({ error: 'newPatient requires name, phone, age, and gender' });
    }

    // DATE_FORMAT, not a bare CURDATE() — mysql2 returns DATE columns as JS
    // Date objects, and passing that object through to date-string-expecting
    // functions (scheduleService.getShiftWindow does `${dateStr}T00:00:00`)
    // silently produces an Invalid Date deep inside, not an error at this
    // call site — the exact IST/timezone bug class this project has hit
    // before. A pre-formatted string sidesteps it entirely.
    const [[{ today }]] = await db.query("SELECT TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') AS today");
    const result = await receptionAdminService.createReceptionAppointment(req.admin.hospital_id, req.admin.id, {
        ...body, date: today, source: 'Walk-in', checkInNow: true
    });
    const mapped = mapCreateError(result);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    res.status(201).json({ success: true, ...result });
};

function respondLifecycle(res, result, notFoundMsg) {
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: notFoundMsg });
    if (result.error === 'INVALID_STATE') return res.status(409).json({ error: result.message });
    if (result.error === 'ALREADY_CHECKED_IN') return res.status(409).json({ error: 'This appointment is already checked in.' });
    res.json({ success: true, ...result });
}

exports.checkIn = async (req, res) => {
    const result = await receptionAdminService.checkIn(req.admin.hospital_id, req.params.id, req.admin.id);
    respondLifecycle(res, result, 'Appointment not found');
};

exports.startConsultation = async (req, res) => {
    const result = await receptionAdminService.startConsultation(req.admin.hospital_id, req.params.id, req.admin.id);
    respondLifecycle(res, result, 'Appointment not found');
};

exports.complete = async (req, res) => {
    const result = await receptionAdminService.complete(req.admin.hospital_id, req.params.id, req.admin.id);
    respondLifecycle(res, result, 'No active (non-completed, non-cancelled) appointment found with that id');
};

exports.markNoShow = async (req, res) => {
    const result = await receptionAdminService.markNoShow(req.admin.hospital_id, req.params.id, req.admin.id);
    respondLifecycle(res, result, 'Appointment not found');
};

exports.getTimeline = async (req, res) => {
    const timeline = await receptionAdminService.getTimeline(req.admin.hospital_id, req.params.id);
    if (!timeline) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ timeline });
};
