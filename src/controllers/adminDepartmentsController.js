const catalogService = require('../services/catalogService');

// Minimal department listing — populates the doctor add/edit form's
// department dropdown. A full Departments management page isn't in scope yet.
exports.list = async (req, res) => {
    const departments = await catalogService.getAllDepartmentsForHospital(req.admin.hospital_id);
    res.json({
        departments: departments.map(d => ({ id: d.id, name: d.name_en }))
    });
};
