const platformAdminService = require('../services/platformAdminService');

// Platform-only cross-hospital search (Stage 4B) — completely separate from
// the hospital-admin panel's own global search (topbar.js's
// runGlobalSearch), which stays scoped to req.admin.hospital_id and is
// untouched by this route.
exports.search = async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
        return res.json({ hospitals: [], doctors: [], patients: [], staff: [] });
    }
    const results = await platformAdminService.globalSearch(q);
    res.json(results);
};
