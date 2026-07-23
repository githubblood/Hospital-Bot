const appointmentAdminService = require('../services/appointmentAdminService');
const rescheduleService = require('../services/rescheduleService');

exports.list = async (req, res) => {
    const { date, status, doctorId, departmentId, appointmentId, search } = req.query;
    const appointments = await appointmentAdminService.listAppointments(req.admin.hospital_id, { date, status, doctorId, departmentId, appointmentId, search });
    res.json({ appointments });
};

exports.getOne = async (req, res) => {
    const appt = await appointmentAdminService.getAppointmentById(req.admin.hospital_id, req.params.id);
    if (!appt) {
        return res.status(404).json({ error: 'Appointment not found' });
    }
    res.json(appt);
};

exports.approve = async (req, res) => {
    const result = await appointmentAdminService.approveAppointment(req.params.id, req.admin.hospital_id, req.admin.id);
    if (!result) {
        return res.status(404).json({ error: 'No pending appointment found with that id' });
    }
    res.json({ success: true, ...result });
};

exports.reject = async (req, res) => {
    const reason = (req.body && req.body.reason) ? String(req.body.reason) : null;
    const result = await appointmentAdminService.rejectAppointment(req.params.id, req.admin.hospital_id, reason, req.admin.id);
    if (!result) {
        return res.status(404).json({ error: 'No pending appointment found with that id' });
    }
    res.json({ success: true, ...result });
};

exports.cancel = async (req, res) => {
    const reason = (req.body && req.body.reason) ? String(req.body.reason) : null;
    const result = await appointmentAdminService.adminCancelAppointment(req.params.id, req.admin.hospital_id, reason, req.admin.id);
    if (!result) {
        return res.status(404).json({ error: 'No active appointment found with that id' });
    }
    res.json({ success: true, ...result });
};

exports.remove = async (req, res) => {
    const result = await appointmentAdminService.deleteAppointment(req.admin.hospital_id, req.params.id);
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Appointment not found' });
    }
    if (result.error === 'NOT_CANCELLED') {
        return res.status(409).json({ error: 'Only cancelled appointments can be deleted. Cancel it first.' });
    }
    res.json({ success: true });
};

exports.removeCancelled = async (req, res) => {
    const count = await appointmentAdminService.deleteCancelledAppointments(req.admin.hospital_id);
    res.json({ success: true, deletedCount: count });
};

// Receptionist-triggered manual reschedule — same create+link mechanism as
// the WhatsApp bot's own reschedule flow, non-interactive.
exports.reschedule = async (req, res) => {
    const { doctorId, date, shift } = req.body || {};
    if (!doctorId || !date || !shift) {
        return res.status(400).json({ error: 'doctorId, date, and shift are all required' });
    }
    const result = await rescheduleService.manualReschedule(req.admin.hospital_id, req.params.id, { doctorId, date, shift, adminId: req.admin.id });
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Appointment not found' });
    }
    if (result.error === 'DOCTOR_NOT_FOUND') {
        return res.status(404).json({ error: 'That doctor was not found for your hospital' });
    }
    if (result.error === 'INVALID_STATE') {
        return res.status(409).json({ error: result.message });
    }
    if (result.error === 'HOSPITAL_SUSPENDED') {
        return res.status(403).json({ error: 'This hospital account has been suspended. Please contact support.' });
    }
    if (result.error === 'SLOT_UNAVAILABLE') {
        return res.status(409).json({ error: 'That slot is not available', reason: result.reason });
    }
    res.json(result);
};
