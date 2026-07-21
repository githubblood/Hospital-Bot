const doctorAdminService = require('../services/doctorAdminService');
const scheduleService = require('../services/scheduleService');
const bookingService = require('../services/bookingService');

// Reused as-is by the Appointments page's filter dropdown (id/name/is_on_leave
// are all it reads; the extra fields here are simply ignored there).
exports.list = async (req, res) => {
    const doctors = await doctorAdminService.listDoctors(req.admin.hospital_id, req.query.search);
    res.json({ doctors });
};

exports.getOne = async (req, res) => {
    const doctor = await doctorAdminService.getDoctor(req.admin.hospital_id, req.params.id);
    if (!doctor) {
        return res.status(404).json({ error: 'Doctor not found' });
    }
    res.json(doctor);
};

function validateBody(body) {
    if (!body || !body.department_id || !body.name || body.consultation_fee == null || !body.schedule_json) {
        return 'department_id, name, consultation_fee, and schedule_json are all required';
    }
    if (typeof body.schedule_json !== 'object' || Array.isArray(body.schedule_json)) {
        return 'schedule_json must be an object';
    }
    return scheduleService.validateSchedule(body.schedule_json);
}

exports.create = async (req, res) => {
    const validationError = validateBody(req.body);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const result = await doctorAdminService.createDoctor(req.admin.hospital_id, req.body);
    if (result.error === 'DEPARTMENT_NOT_FOUND') {
        return res.status(400).json({ error: 'That department does not belong to your hospital' });
    }
    res.status(201).json({ success: true, id: result.id });
};

exports.update = async (req, res) => {
    if (req.body && req.body.schedule_json) {
        if (typeof req.body.schedule_json !== 'object' || Array.isArray(req.body.schedule_json)) {
            return res.status(400).json({ error: 'schedule_json must be an object' });
        }
        const scheduleError = scheduleService.validateSchedule(req.body.schedule_json);
        if (scheduleError) {
            return res.status(400).json({ error: scheduleError });
        }
    }

    const result = await doctorAdminService.updateDoctor(req.admin.hospital_id, req.params.id, req.body || {});
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Doctor not found' });
    }
    if (result.error === 'DEPARTMENT_NOT_FOUND') {
        return res.status(400).json({ error: 'That department does not belong to your hospital' });
    }
    res.json({ success: true, id: result.id });
};

exports.toggleLeave = async (req, res) => {
    const result = await doctorAdminService.toggleLeave(req.admin.hospital_id, req.params.id);
    if (!result) {
        return res.status(404).json({ error: 'Doctor not found' });
    }
    res.json({ success: true, ...result });
};

// Powers the Appointments page's manual-reschedule modal: which shifts on a
// given date actually have room, override-aware (a shift closed by an
// active emergency override is simply absent from the result, same as a
// shift the doctor doesn't work that day).
exports.getAvailability = async (req, res) => {
    const doctor = await doctorAdminService.getDoctor(req.admin.hospital_id, req.params.id);
    if (!doctor) {
        return res.status(404).json({ error: 'Doctor not found' });
    }
    if (!req.query.date) {
        return res.status(400).json({ error: 'date is required' });
    }
    const shifts = await bookingService.getShiftsWithCapacity(doctor, req.query.date, req.admin.hospital_id);
    res.json({ shifts });
};

exports.remove = async (req, res) => {
    const result = await doctorAdminService.deleteDoctor(req.admin.hospital_id, req.params.id);
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Doctor not found' });
    }
    if (result.error === 'HAS_APPOINTMENTS') {
        return res.status(409).json({
            error: `This doctor has ${result.appointmentCount} appointment(s) on record and can't be deleted (that history would be lost). Mark them as on leave instead.`
        });
    }
    res.json({ success: true });
};
