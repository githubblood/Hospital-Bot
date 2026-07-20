const billingAdminService = require('../services/billingAdminService');

exports.getStats = async (req, res) => {
    const stats = await billingAdminService.getStats(req.admin.hospital_id);
    res.json(stats);
};

exports.list = async (req, res) => {
    const { date, status, search } = req.query;
    const bills = await billingAdminService.listBills(req.admin.hospital_id, { date, status, search });
    res.json({ bills });
};

exports.getOne = async (req, res) => {
    const bill = await billingAdminService.getBillById(req.admin.hospital_id, req.params.id);
    if (!bill) {
        return res.status(404).json({ error: 'Bill not found' });
    }
    res.json(bill);
};

exports.getUnbilledForPatient = async (req, res) => {
    const appointments = await billingAdminService.getUnbilledAppointments(req.admin.hospital_id, req.params.patientId);
    res.json({ appointments });
};

exports.create = async (req, res) => {
    if (!req.body || !req.body.appointment_id) {
        return res.status(400).json({ error: 'appointment_id is required' });
    }
    const result = await billingAdminService.createBill(req.admin.hospital_id, req.body);
    if (result.error === 'APPOINTMENT_NOT_FOUND') {
        return res.status(400).json({ error: 'That appointment does not belong to your hospital' });
    }
    if (result.error === 'ALREADY_BILLED') {
        return res.status(409).json({ error: 'This appointment already has a bill' });
    }
    res.status(201).json({ success: true, id: result.id });
};

exports.markPaid = async (req, res) => {
    const result = await billingAdminService.markPaid(req.admin.hospital_id, req.params.id);
    if (!result) {
        return res.status(404).json({ error: 'Bill not found' });
    }
    res.json({ success: true, ...result });
};

exports.sendWhatsApp = async (req, res) => {
    const result = await billingAdminService.sendBillWhatsApp(req.admin.hospital_id, req.params.id);
    if (!result) {
        return res.status(404).json({ error: 'Bill not found' });
    }
    res.json({ success: true });
};
