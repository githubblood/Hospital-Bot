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

const ADMIN_ROLES = ['Hospital Administrator', 'Receptionist', 'Super Admin'];

exports.updateAccount = async (req, res) => {
    const { name, role, current_password: currentPassword, new_password: newPassword } = req.body || {};
    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }
    if (role && !ADMIN_ROLES.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${ADMIN_ROLES.join(', ')}` });
    }
    if (newPassword && newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const result = await settingsAdminService.updateAccount(req.admin.id, { name, role: role || 'Hospital Administrator', currentPassword, newPassword });
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
