// Real RBAC enforcement — until now admin_users.role was 100% display-only
// (see settingsController.js's fixed self-escalation bug). Ranks are ordinal
// so requireRole('Hospital Administrator') also passes 'Super Admin' (that
// hospital's own founding admin outranks a regular admin it created).
const ROLE_RANK = { 'Receptionist': 1, 'Hospital Administrator': 2, 'Super Admin': 3 };

module.exports = function requireRole(minRole) {
    return (req, res, next) => {
        if (!req.admin || (ROLE_RANK[req.admin.role] || 0) < ROLE_RANK[minRole]) {
            return res.status(403).json({ error: 'Insufficient permissions for this action' });
        }
        next();
    };
};
