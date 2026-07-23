const adminActivityService = require('../services/adminActivityService');

exports.getActivity = async (req, res) => {
    const activity = await adminActivityService.getRecentActivity(req.admin.hospital_id);
    res.json({ activity });
};
