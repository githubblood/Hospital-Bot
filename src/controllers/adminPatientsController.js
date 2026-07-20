const patientAdminService = require('../services/patientAdminService');

exports.list = async (req, res) => {
    const patients = await patientAdminService.listPatients(req.admin.hospital_id, req.query.search);
    res.json({ patients });
};

exports.getOne = async (req, res) => {
    const patient = await patientAdminService.getPatientWithHistory(req.admin.hospital_id, req.params.id);
    if (!patient) {
        return res.status(404).json({ error: 'Patient not found' });
    }
    res.json(patient);
};
