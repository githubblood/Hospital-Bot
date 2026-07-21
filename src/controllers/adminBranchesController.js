const branchAdminService = require('../services/branchAdminService');

exports.list = async (req, res) => {
    const { search, status, page, pageSize } = req.query;
    const result = await branchAdminService.listBranches(req.admin.hospital_id, { search, status, page, pageSize });
    res.json(result);
};

exports.getOne = async (req, res) => {
    const branch = await branchAdminService.getBranch(req.admin.hospital_id, req.params.id);
    if (!branch) {
        return res.status(404).json({ error: 'Branch not found' });
    }
    res.json(branch);
};

exports.create = async (req, res) => {
    const result = await branchAdminService.createBranch(req.admin.hospital_id, req.body || {});
    if (result.error === 'VALIDATION') {
        return res.status(400).json({ error: result.message });
    }
    if (result.error === 'DUPLICATE_NAME') {
        return res.status(409).json({ error: 'A branch with this name already exists' });
    }
    res.status(201).json({ success: true, id: result.id });
};

exports.update = async (req, res) => {
    const result = await branchAdminService.updateBranch(req.admin.hospital_id, req.params.id, req.body || {});
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Branch not found' });
    }
    if (result.error === 'VALIDATION') {
        return res.status(400).json({ error: result.message });
    }
    if (result.error === 'DUPLICATE_NAME') {
        return res.status(409).json({ error: 'A branch with this name already exists' });
    }
    res.json({ success: true, id: result.id });
};

exports.archive = async (req, res) => {
    const result = await branchAdminService.archiveBranch(req.admin.hospital_id, req.params.id);
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Branch not found' });
    }
    if (result.error === 'IN_USE') {
        return res.status(409).json({
            error: `This branch has ${result.count} active department${result.count === 1 ? '' : 's'} under it and can't be archived. Archive or reassign them first.`,
            activeDepartmentCount: result.count
        });
    }
    res.json({ success: true, ...result });
};

exports.restore = async (req, res) => {
    const result = await branchAdminService.restoreBranch(req.admin.hospital_id, req.params.id);
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Branch not found' });
    }
    res.json({ success: true, ...result });
};
