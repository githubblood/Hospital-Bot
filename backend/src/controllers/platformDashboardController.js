const platformAdminService = require('../services/platformAdminService');

exports.getStats = async (req, res) => {
    const stats = await platformAdminService.getPlatformDashboardStats();
    res.json(stats);
};

exports.getAuditLog = async (req, res) => {
    const { hospitalId, actionType, limit, offset } = req.query;
    const result = await platformAdminService.listAuditLog({ hospitalId, actionType, limit, offset });
    res.json(result);
};

// Read-only (Stage 4B) — no settings are writable from this route yet.
exports.getSettings = async (req, res) => {
    const settings = await platformAdminService.getPlatformSettings();
    res.json(settings);
};
