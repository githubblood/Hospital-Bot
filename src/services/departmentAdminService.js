const db = require('../config/db');
const catalogService = require('./catalogService');
const dependencyGuard = require('./dependencyGuard');
const subscriptionService = require('./subscriptionService');

const DEFAULT_PAGE_SIZE = 10;

// The Branches admin module doesn't exist yet — a self-registered hospital
// may genuinely have zero branch rows (hospitalRegistrationService never
// inserts one). departments.branch_id is NOT NULL, so department creation is
// blocked until an admin explicitly creates a branch (see createDepartment's
// NO_BRANCH error) — this deliberately does NOT auto-create one. The system
// must never create production data (a branch row) without an admin action.
async function getDefaultBranchId(hospitalId) {
    const branch = await catalogService.getDefaultBranch(hospitalId);
    return branch ? branch.id : null;
}

// Uniqueness is enforced here, not as a DB constraint — departments.branch_id
// is the direct FK column (no hospital_id column on this table, per the
// deliberate decision to extend rather than restructure the existing
// bot-facing table), so "unique within the hospital" means joining through
// branches, the same ownership-check pattern catalogService already uses.
async function nameExistsInHospital(hospitalId, name, excludeId) {
    const params = [hospitalId, name];
    let sql = `SELECT dep.id FROM departments dep
               JOIN branches b ON b.id = dep.branch_id
               WHERE b.hospital_id = ? AND dep.name_en = ?`;
    if (excludeId != null) {
        sql += ' AND dep.id != ?';
        params.push(excludeId);
    }
    const [rows] = await db.query(sql, params);
    return rows.length > 0;
}

async function listDepartments(hospitalId, { search, status, page, pageSize } = {}) {
    const params = [hospitalId];
    let where = 'b.hospital_id = ?';
    if (search) {
        where += ' AND dep.name_en ILIKE ?';
        params.push(`%${search}%`);
    }
    if (status) {
        where += ' AND dep.status = ?';
        params.push(status);
    }

    const [[{ total }]] = await db.query(
        `SELECT COUNT(*) AS total FROM departments dep JOIN branches b ON b.id = dep.branch_id WHERE ${where}`,
        params
    );

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(pageSize, 10) || DEFAULT_PAGE_SIZE));
    const offset = (pageNum - 1) * size;

    const [rows] = await db.query(
        `SELECT dep.id, dep.branch_id, dep.name_en AS name, dep.name_hi, dep.description,
                dep.display_order, dep.status, dep.created_at, dep.updated_at,
                b.name AS branch_name,
                (SELECT COUNT(*) FROM doctors WHERE department_id = dep.id) AS doctor_count
         FROM departments dep
         JOIN branches b ON b.id = dep.branch_id
         WHERE ${where}
         ORDER BY dep.display_order ASC, dep.name_en ASC
         LIMIT ? OFFSET ?`,
        [...params, size, offset]
    );

    // The frontend needs this to know whether to disable "+ Add Department"
    // and show the "create a branch first" empty state, rather than only
    // discovering the problem when a create attempt 409s.
    const activeBranches = await catalogService.getActiveBranches(hospitalId);

    return { departments: rows, total, page: pageNum, pageSize: size, hasActiveBranch: activeBranches.length > 0 };
}

async function getDepartment(hospitalId, departmentId) {
    const [rows] = await db.query(
        `SELECT dep.id, dep.branch_id, dep.name_en AS name, dep.name_hi, dep.description,
                dep.display_order, dep.status, dep.created_at, dep.updated_at
         FROM departments dep
         JOIN branches b ON b.id = dep.branch_id
         WHERE dep.id = ? AND b.hospital_id = ?`,
        [departmentId, hospitalId]
    );
    return rows[0] || null;
}

async function createDepartment(hospitalId, { name, name_hi, description, display_order }) {
    // Stage 4C: plan-limit guard — see branchAdminService.createBranch's
    // comment on the same check for the "why" (allowed by default for every
    // pre-Stage-4C hospital).
    const limitCheck = await subscriptionService.checkLimit(hospitalId, 'departments');
    if (!limitCheck.allowed) return { error: limitCheck.error, message: limitCheck.message };

    const cleanName = (name || '').trim();
    if (!cleanName) return { error: 'NAME_REQUIRED' };

    const branchId = await getDefaultBranchId(hospitalId);
    if (!branchId) return { error: 'NO_BRANCH' };

    const exists = await nameExistsInHospital(hospitalId, cleanName);
    if (exists) return { error: 'DUPLICATE_NAME' };

    const [result] = await db.query(
        'INSERT INTO departments (branch_id, name_en, name_hi, description, display_order) VALUES (?, ?, ?, ?, ?)',
        [branchId, cleanName, (name_hi || '').trim() || cleanName, description || null, display_order || 0]
    );
    return { id: result.insertId };
}

async function updateDepartment(hospitalId, departmentId, { name, name_hi, description, display_order }) {
    const existing = await getDepartment(hospitalId, departmentId);
    if (!existing) return { error: 'NOT_FOUND' };

    const cleanName = name != null ? name.trim() : existing.name;
    if (!cleanName) return { error: 'NAME_REQUIRED' };

    if (cleanName !== existing.name) {
        const exists = await nameExistsInHospital(hospitalId, cleanName, departmentId);
        if (exists) return { error: 'DUPLICATE_NAME' };
    }

    await db.query(
        'UPDATE departments SET name_en = ?, name_hi = ?, description = ?, display_order = ? WHERE id = ?',
        [
            cleanName,
            name_hi != null ? (name_hi.trim() || cleanName) : existing.name_hi,
            description !== undefined ? (description || null) : existing.description,
            display_order != null ? display_order : existing.display_order,
            departmentId
        ]
    );
    return { id: Number(departmentId) };
}

async function countActiveDoctors(departmentId) {
    const [[{ cnt }]] = await db.query('SELECT COUNT(*) AS cnt FROM doctors WHERE department_id = ?', [departmentId]);
    return cnt;
}

async function setStatus(hospitalId, departmentId, status) {
    const existing = await getDepartment(hospitalId, departmentId);
    if (!existing) return { error: 'NOT_FOUND' };
    if (existing.status === status) return { id: Number(departmentId), status };

    await db.query('UPDATE departments SET status = ? WHERE id = ?', [status, departmentId]);
    return { id: Number(departmentId), status };
}

// A department with doctors still assigned can't be archived — an archived
// department disappears from the WhatsApp bot's active picker path (once a
// future stage wires status into catalogService, per the earlier known gap),
// so its doctors would become invisible/orphaned rather than reassigned.
// Doctors don't have their own archived/deleted state (only is_on_leave, a
// temporary flag) — every doctor row still linked to this department counts,
// leave status or not, since leave is temporary and the doctor still belongs
// here. Uses the shared dependencyGuard so Branches' own archive (checking
// active departments under it) returns the exact same error shape.
async function archiveDepartment(hospitalId, departmentId) {
    const existing = await getDepartment(hospitalId, departmentId);
    if (!existing) return { error: 'NOT_FOUND' };
    if (existing.status === 'Inactive') return { id: Number(departmentId), status: 'Inactive' };

    const doctorCount = await countActiveDoctors(departmentId);
    const blocked = dependencyGuard.blockIfInUse(doctorCount);
    if (blocked) return blocked;

    return setStatus(hospitalId, departmentId, 'Inactive');
}

const restoreDepartment = (hospitalId, departmentId) => setStatus(hospitalId, departmentId, 'Active');

module.exports = {
    listDepartments, getDepartment, createDepartment, updateDepartment,
    archiveDepartment, restoreDepartment
};
