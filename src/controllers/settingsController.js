const settingsAdminService = require('../services/settingsAdminService');

exports.getHospital = async (req, res) => {
    const profile = await settingsAdminService.getProfile(req.admin.hospital_id);
    res.json(profile || {});
};

exports.updateHospital = async (req, res) => {
    if (!req.body || !req.body.name) {
        return res.status(400).json({ error: 'Hospital name is required' });
    }
    await settingsAdminService.updateProfile(req.admin.hospital_id, req.body);
    res.json({ success: true });
};

exports.getFeatures = async (req, res) => {
    const features = await settingsAdminService.getFeatures(req.admin.hospital_id);
    res.json(features || {});
};

exports.updateFeatures = async (req, res) => {
    await settingsAdminService.updateFeatures(req.admin.hospital_id, req.body || {});
    res.json({ success: true });
};

exports.getAccount = async (req, res) => {
    const account = await settingsAdminService.getAccount(req.admin.id);
    res.json(account || {});
};

// role is deliberately NOT settable here — it used to be, with only an
// enum-membership check and no check against the caller's own current role,
// which let any authenticated admin (e.g. a Receptionist) grant themselves
// 'Super Admin' via this endpoint. Role changes now go through
// adminStaffController (requireRole('Hospital Administrator'), and a staff
// member can never change their own role even there — see staffAdminService).
exports.updateAccount = async (req, res) => {
    const { name, current_password: currentPassword, new_password: newPassword } = req.body || {};
    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }
    if (newPassword && newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const result = await settingsAdminService.updateAccount(req.admin.id, { name, currentPassword, newPassword });
    if (result.error === 'WRONG_PASSWORD') {
        return res.status(400).json({ error: 'Current password is incorrect' });
    }
    res.json({ success: true });
};

exports.getWhatsApp = async (req, res) => {
    const config = await settingsAdminService.getWhatsAppConfig(req.admin.hospital_id);
    res.json(config || {});
};

exports.updateWhatsApp = async (req, res) => {
    if (!req.body || !req.body.whatsapp_business_phone_id || !req.body.whatsapp_access_token) {
        return res.status(400).json({ error: 'Phone Number ID and Access Token are both required' });
    }
    await settingsAdminService.updateWhatsAppConfig(req.admin.hospital_id, req.body);
    res.json({ success: true });
};

exports.testWhatsApp = async (req, res) => {
    const result = await settingsAdminService.testWhatsAppConnection(req.admin.hospital_id);
    res.json(result);
};
