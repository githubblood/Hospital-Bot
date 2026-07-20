const appointmentAdminService = require('../services/appointmentAdminService');

exports.list = async (req, res) => {
    const { date, status, doctorId } = req.query;
    const appointments = await appointmentAdminService.listAppointments(req.admin.hospital_id, { date, status, doctorId });
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
    const result = await appointmentAdminService.approveAppointment(req.params.id, req.admin.hospital_id);
    if (!result) {
        return res.status(404).json({ error: 'No pending appointment found with that id' });
    }
    res.json({ success: true, ...result });
};

exports.reject = async (req, res) => {
    const reason = (req.body && req.body.reason) ? String(req.body.reason) : null;
    const result = await appointmentAdminService.rejectAppointment(req.params.id, req.admin.hospital_id, reason);
    if (!result) {
        return res.status(404).json({ error: 'No pending appointment found with that id' });
    }
    res.json({ success: true, ...result });
};

exports.cancel = async (req, res) => {
    const reason = (req.body && req.body.reason) ? String(req.body.reason) : null;
    const result = await appointmentAdminService.adminCancelAppointment(req.params.id, req.admin.hospital_id, reason);
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
