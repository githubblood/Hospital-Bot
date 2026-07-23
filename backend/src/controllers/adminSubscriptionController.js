const subscriptionService = require('../services/subscriptionService');

// Read-only, own-hospital-only (Stage 4C item 9) — req.admin.hospital_id
// comes from the caller's own JWT, never a client-supplied id, so there is
// no way to request another hospital's subscription through this route.
exports.getMySubscription = async (req, res) => {
    const detail = await subscriptionService.getHospitalSubscription(req.admin.hospital_id);
    if (!detail) return res.status(404).json({ error: 'Subscription information not found' });
    res.json(detail);
};
