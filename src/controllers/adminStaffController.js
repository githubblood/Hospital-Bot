const staffAdminService = require('../services/staffAdminService');

exports.list = async (req, res) => {
    const staff = await staffAdminService.listStaff(req.admin.hospital_id);
    res.json({ staff });
};

exports.create = async (req, res) => {
    const result = await staffAdminService.createStaff(req.admin.hospital_id, req.body || {});
    if (result.error === 'PLAN_LIMIT_REACHED') {
        return res.status(403).json({ error: result.message });
    }
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }
    res.status(201).json({ success: true, id: result.id });
};

exports.updateRole = async (req, res) => {
    const { role } = req.body || {};
    if (!role) {
        return res.status(400).json({ error: 'role is required' });
    }
    const result = await staffAdminService.updateStaffRole(req.admin.hospital_id, req.params.id, role, req.admin.id);
    if (result.error === 'INVALID_ROLE') {
        return res.status(400).json({ error: `role must be one of: ${staffAdminService.ROLES.join(', ')}` });
    }
    if (result.error === 'CANNOT_CHANGE_OWN_ROLE') {
        return res.status(403).json({ error: 'You cannot change your own role. Ask another Hospital Administrator to do it.' });
    }
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Staff member not found' });
    }
    if (result.error === 'LAST_ADMIN') {
        return res.status(409).json({ error: 'This is the only Hospital Administrator / Super Admin left — assign another admin before demoting this one.' });
    }
    res.json({ success: true, id: result.id, role: result.role });
};

exports.remove = async (req, res) => {
    const result = await staffAdminService.deleteStaff(req.admin.hospital_id, req.params.id, req.admin.id);
    if (result.error === 'CANNOT_DELETE_SELF') {
        return res.status(403).json({ error: 'You cannot delete your own account.' });
    }
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Staff member not found' });
    }
    if (result.error === 'LAST_ADMIN') {
        return res.status(409).json({ error: 'This is the only Hospital Administrator / Super Admin left — assign another admin before removing this one.' });
    }
    res.json({ success: true });
};
