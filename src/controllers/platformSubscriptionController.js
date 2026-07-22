const subscriptionService = require('../services/subscriptionService');

function buildRequestMeta(req) {
    return { ipAddress: req.ip, userAgent: req.get('user-agent'), sessionId: req.platformAdmin.session_id };
}

exports.list = async (req, res) => {
    const { search, status, page, pageSize } = req.query;
    const result = await subscriptionService.listHospitalSubscriptions({ search, status, page, pageSize });
    res.json(result);
};

exports.getOne = async (req, res) => {
    const detail = await subscriptionService.getHospitalSubscription(req.params.hospitalId);
    if (!detail) return res.status(404).json({ error: 'Hospital not found' });
    res.json(detail);
};

exports.getHistory = async (req, res) => {
    const { actionType, limit, offset } = req.query;
    const result = await subscriptionService.listSubscriptionAuditLog({ hospitalId: req.params.hospitalId, actionType, limit, offset });
    res.json(result);
};

// Covers Assign/Upgrade/Downgrade in one endpoint — all three are "set this
// hospital's plan to X", the service layer determines PlanAssigned vs.
// PlanChanged for the audit trail based on whether a plan was already set.
exports.assign = async (req, res) => {
    const result = await subscriptionService.assignPlan(req.params.hospitalId, req.body || {}, req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req));
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Hospital not found' });
    if (result.error === 'PLAN_NOT_FOUND') return res.status(404).json({ error: 'Plan not found' });
    if (result.error === 'PLAN_ARCHIVED') return res.status(409).json({ error: 'This plan is archived and cannot be assigned to new hospitals' });
    if (result.error === 'PLAN_REQUIRED') return res.status(400).json({ error: 'planId is required' });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
};

exports.extendTrial = async (req, res) => {
    const result = await subscriptionService.extendTrial(req.params.hospitalId, req.body?.additionalDays, req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req));
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Hospital not found' });
    if (result.error === 'INVALID_DAYS') return res.status(400).json({ error: 'additionalDays must be a positive whole number' });
    res.json(result);
};

exports.activate = async (req, res) => {
    const result = await subscriptionService.setSubscriptionStatus(req.params.hospitalId, 'Active', req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req));
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Hospital not found' });
    if (result.error === 'ALREADY_ACTIVE') return res.status(409).json({ error: 'This subscription is already active' });
    res.json(result);
};

exports.suspend = async (req, res) => {
    const result = await subscriptionService.setSubscriptionStatus(req.params.hospitalId, 'Suspended', req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req));
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Hospital not found' });
    if (result.error === 'ALREADY_SUSPENDED') return res.status(409).json({ error: 'This subscription is already suspended' });
    res.json(result);
};

// Distinct from activate only in which audit action_type it records
// (SubscriptionReactivated vs. SubscriptionActivated) — same underlying
// status transition, different history label for a subscription coming back
// from Suspended specifically.
exports.reactivate = async (req, res) => {
    const result = await subscriptionService.setSubscriptionStatus(
        req.params.hospitalId, 'Active', req.platformAdmin.id, req.platformAdmin.name, buildRequestMeta(req), { isReactivation: true }
    );
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Hospital not found' });
    if (result.error === 'ALREADY_ACTIVE') return res.status(409).json({ error: 'This subscription is already active' });
    res.json(result);
};
