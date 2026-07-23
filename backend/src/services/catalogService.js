const db = require('../config/db');

async function getActiveBranches(hospitalId) {
    const [rows] = await db.query('SELECT * FROM branches WHERE hospital_id = ? AND is_active = TRUE', [hospitalId]);
    return rows;
}

// Used when multi_branch = false: the hospital's single active branch, resolved
// by row rather than assumed to be id 1.
async function getDefaultBranch(hospitalId) {
    const [rows] = await db.query(
        'SELECT * FROM branches WHERE hospital_id = ? AND is_active = TRUE ORDER BY id LIMIT 1',
        [hospitalId]
    );
    return rows[0] || null;
}

async function getDepartments(branchId) {
    const [rows] = await db.query('SELECT * FROM departments WHERE branch_id = ?', [branchId]);
    return rows;
}

async function getDefaultDepartment(branchId) {
    const [rows] = await db.query('SELECT * FROM departments WHERE branch_id = ? ORDER BY id LIMIT 1', [branchId]);
    return rows[0] || null;
}

async function getDoctors(departmentId) {
    const [rows] = await db.query('SELECT * FROM doctors WHERE department_id = ? AND is_on_leave = FALSE', [departmentId]);
    return rows;
}

async function getDefaultDoctor(departmentId) {
    const [rows] = await db.query(
        'SELECT * FROM doctors WHERE department_id = ? AND is_on_leave = FALSE ORDER BY id LIMIT 1',
        [departmentId]
    );
    return rows[0] || null;
}

async function getDoctorById(doctorId) {
    const [rows] = await db.query('SELECT * FROM doctors WHERE id = ?', [doctorId]);
    return rows[0] || null;
}

// Every doctor in an active branch of the hospital, with their department and
// branch names attached — used by the walk-in info screen (Scenario 4).
async function getAllDoctorsForHospital(hospitalId) {
    const [rows] = await db.query(
        `SELECT doc.*, dep.name_en AS department_name, b.name AS branch_name
         FROM doctors doc
         JOIN departments dep ON dep.id = doc.department_id
         JOIN branches b ON b.id = dep.branch_id
         WHERE b.hospital_id = ? AND b.is_active = TRUE
         ORDER BY b.id, dep.id, doc.id`,
        [hospitalId]
    );
    return rows;
}

// Every department across all active branches of the hospital — used by the
// admin panel's doctor add/edit form (department dropdown), which needs the
// hospital's full department list rather than one branch at a time.
async function getAllDepartmentsForHospital(hospitalId) {
    const [rows] = await db.query(
        `SELECT dep.* FROM departments dep
         JOIN branches b ON b.id = dep.branch_id
         WHERE b.hospital_id = ? AND b.is_active = TRUE
         ORDER BY b.id, dep.id`,
        [hospitalId]
    );
    return rows;
}

// True if the given department belongs to (some active branch of) the
// hospital — an ownership check used before creating/reassigning a doctor.
async function departmentBelongsToHospital(departmentId, hospitalId) {
    const [rows] = await db.query(
        `SELECT dep.id FROM departments dep
         JOIN branches b ON b.id = dep.branch_id
         WHERE dep.id = ? AND b.hospital_id = ?`,
        [departmentId, hospitalId]
    );
    return rows.length > 0;
}

module.exports = {
    getActiveBranches,
    getDefaultBranch,
    getDepartments,
    getDefaultDepartment,
    getDoctors,
    getDefaultDoctor,
    getDoctorById,
    getAllDoctorsForHospital,
    getAllDepartmentsForHospital,
    departmentBelongsToHospital
};
