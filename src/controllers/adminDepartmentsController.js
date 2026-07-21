const catalogService = require('../services/catalogService');
const departmentAdminService = require('../services/departmentAdminService');

// Minimal department listing — populates the doctor add/edit form's
// department dropdown. Deliberately left open to every authenticated staff
// member (not requireRole-gated like the full CRUD below) since the Doctors
// page's dropdown loads this unconditionally on page load for any logged-in
// admin, including a Receptionist who can view (but not submit) that form.
exports.list = async (req, res) => {
    const departments = await catalogService.getAllDepartmentsForHospital(req.admin.hospital_id);
    res.json({
        departments: departments.map(d => ({ id: d.id, name: d.name_en }))
    });
};

// Full Departments management page — richer shape, pagination, search/status
// filter. requireRole('Hospital Administrator') applied at the route level.
exports.listFull = async (req, res) => {
    const { search, status, page, pageSize } = req.query;
    const result = await departmentAdminService.listDepartments(req.admin.hospital_id, { search, status, page, pageSize });
    res.json(result);
};

exports.getOne = async (req, res) => {
    const department = await departmentAdminService.getDepartment(req.admin.hospital_id, req.params.id);
    if (!department) {
        return res.status(404).json({ error: 'Department not found' });
    }
    res.json(department);
};

exports.create = async (req, res) => {
    const result = await departmentAdminService.createDepartment(req.admin.hospital_id, req.body || {});
    if (result.error === 'NAME_REQUIRED') {
        return res.status(400).json({ error: 'Department name is required' });
    }
    if (result.error === 'NO_BRANCH') {
        return res.status(409).json({ error: 'No branch exists yet. Please create a branch before creating departments.' });
    }
    if (result.error === 'DUPLICATE_NAME') {
        return res.status(409).json({ error: 'A department with this name already exists' });
    }
    res.status(201).json({ success: true, id: result.id });
};

exports.update = async (req, res) => {
    const result = await departmentAdminService.updateDepartment(req.admin.hospital_id, req.params.id, req.body || {});
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Department not found' });
    }
    if (result.error === 'NAME_REQUIRED') {
        return res.status(400).json({ error: 'Department name is required' });
    }
    if (result.error === 'DUPLICATE_NAME') {
        return res.status(409).json({ error: 'A department with this name already exists' });
    }
    res.json({ success: true, id: result.id });
};

exports.archive = async (req, res) => {
    const result = await departmentAdminService.archiveDepartment(req.admin.hospital_id, req.params.id);
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Department not found' });
    }
    if (result.error === 'IN_USE') {
        return res.status(409).json({
            error: `This department has ${result.count} active doctor${result.count === 1 ? '' : 's'} assigned and can't be archived. Reassign or remove them first.`,
            activeDoctorCount: result.count
        });
    }
    res.json({ success: true, ...result });
};

exports.restore = async (req, res) => {
    const result = await departmentAdminService.restoreDepartment(req.admin.hospital_id, req.params.id);
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Department not found' });
    }
    res.json({ success: true, ...result });
};
