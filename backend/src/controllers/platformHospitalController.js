const platformAdminService = require('../services/platformAdminService');

// Built once per request and threaded into every audited mutation below
// (Stage 4B audit improvements: ip_address/user_agent/session_id on every
// platform_audit_log row). session_id comes straight off the decoded JWT
// (platformJwtAuth already attaches the whole payload to req.platformAdmin,
// including the session_id minted at login — see platformAuthController.login).
function buildRequestMeta(req) {
    return { ipAddress: req.ip, userAgent: req.get('user-agent'), sessionId: req.platformAdmin.session_id };
}

exports.list = async (req, res) => {
    const { search, status, page, pageSize } = req.query;
    const result = await platformAdminService.listHospitals({ search, status, page, pageSize });
    res.json(result);
};

exports.getOne = async (req, res) => {
    const detail = await platformAdminService.getHospitalDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Hospital not found' });
    res.json(detail);
};

exports.create = async (req, res) => {
    const result = await platformAdminService.createHospital(req.body || {}, req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req));
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json({ success: true, ...result });
};

exports.update = async (req, res) => {
    const result = await platformAdminService.updateHospital(req.params.id, req.body || {}, req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req));
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Hospital not found' });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
};

exports.suspend = async (req, res) => {
    const result = await platformAdminService.setHospitalStatus(req.params.id, 'Suspended', req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req));
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Hospital not found' });
    if (result.error === 'ALREADY_SUSPENDED') return res.status(409).json({ error: 'This hospital is already suspended' });
    res.json(result);
};

exports.activate = async (req, res) => {
    const result = await platformAdminService.setHospitalStatus(req.params.id, 'Active', req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req));
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Hospital not found' });
    if (result.error === 'ALREADY_ACTIVE') return res.status(409).json({ error: 'This hospital is already active' });
    res.json(result);
};
