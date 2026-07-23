const subscriptionService = require('../services/subscriptionService');

function buildRequestMeta(req) {
    return { ipAddress: req.ip, userAgent: req.get('user-agent'), sessionId: req.platformAdmin.session_id };
}

exports.list = async (req, res) => {
    const { status, page, pageSize } = req.query;
    const result = await subscriptionService.listPlans({ status, page, pageSize });
    res.json(result);
};

exports.getOne = async (req, res) => {
    const plan = await subscriptionService.getPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    res.json(plan);
};

exports.create = async (req, res) => {
    const result = await subscriptionService.createPlan(req.body || {}, req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req));
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json({ success: true, ...result });
};

exports.update = async (req, res) => {
    const result = await subscriptionService.updatePlan(req.params.id, req.body || {}, req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req));
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Plan not found' });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
};

exports.archive = async (req, res) => {
    const result = await subscriptionService.archivePlan(req.params.id, req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req));
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Plan not found' });
    if (result.error === 'ALREADY_ARCHIVED') return res.status(409).json({ error: 'This plan is already archived' });
    res.json(result);
};

exports.restore = async (req, res) => {
    const result = await subscriptionService.restorePlan(req.params.id, req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req));
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Plan not found' });
    if (result.error === 'ALREADY_ACTIVE') return res.status(409).json({ error: 'This plan is already active' });
    res.json(result);
};
