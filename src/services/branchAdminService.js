const db = require('../config/db');
const dependencyGuard = require('./dependencyGuard');
const { isValidEmail, isValidPhone } = require('../utils/validators');

const DEFAULT_PAGE_SIZE = 10;

// "Active"/"Inactive" shown throughout the admin UI is derived directly from
// the existing is_active boolean the WhatsApp bot already reads — not a
// second status column. Keeps this module's public shape consistent with
// departmentAdminService's status strings without duplicating source of truth.
function toStatus(isActive) {
    return isActive ? 'Active' : 'Inactive';
}

// Case/whitespace-insensitive: "Main Branch", "main branch", "  Main Branch  "
// are all the same name for uniqueness purposes, per the explicit requirement.
// LOWER(TRIM(...)) on both sides rather than relying on the column's default
// collation, so this is correct regardless of what collation the DB was
// created with.
async function nameExistsInHospital(hospitalId, name, excludeId) {
    const params = [hospitalId, name.trim().toLowerCase()];
    let sql = `SELECT id FROM branches WHERE hospital_id = ? AND LOWER(TRIM(name)) = ?`;
    if (excludeId != null) {
        sql += ' AND id != ?';
        params.push(excludeId);
    }
    const [rows] = await db.query(sql, params);
    return rows.length > 0;
}

function validateFields({ name, address, phone, email }, { partial }) {
    if (!partial || name !== undefined) {
        if (!name || !name.trim()) return 'Branch name is required';
    }
    if (!partial || address !== undefined) {
        if (!address || !address.trim()) return 'Address is required';
    }
    if (phone != null && phone.trim() && !isValidPhone(phone.trim())) {
        return 'Phone number must be 10-15 digits';
    }
    if (email != null && email.trim() && !isValidEmail(email.trim())) {
        return 'Not a valid email address';
    }
    return null;
}

async function listBranches(hospitalId, { search, status, page, pageSize } = {}) {
    const params = [hospitalId];
    let where = 'hospital_id = ?';
    if (search) {
        where += ' AND name LIKE ?';
        params.push(`%${search}%`);
    }
    if (status === 'Active') {
        where += ' AND is_active = TRUE';
    } else if (status === 'Inactive') {
        where += ' AND is_active = FALSE';
    }

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM branches WHERE ${where}`, params);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(pageSize, 10) || DEFAULT_PAGE_SIZE));
    const offset = (pageNum - 1) * size;

    const [rows] = await db.query(
        `SELECT id, hospital_id, name, address, phone, email, is_active, created_at, updated_at,
                (SELECT COUNT(*) FROM departments WHERE branch_id = branches.id AND status = 'Active') AS active_department_count
         FROM branches
         WHERE ${where}
         ORDER BY name ASC
         LIMIT ? OFFSET ?`,
        [...params, size, offset]
    );

    return {
        branches: rows.map(r => ({ ...r, status: toStatus(r.is_active) })),
        total, page: pageNum, pageSize: size
    };
}

async function getBranch(hospitalId, branchId) {
    const [rows] = await db.query(
        'SELECT id, hospital_id, name, address, phone, email, is_active, created_at, updated_at FROM branches WHERE id = ? AND hospital_id = ?',
        [branchId, hospitalId]
    );
    if (!rows[0]) return null;
    return { ...rows[0], status: toStatus(rows[0].is_active) };
}

async function createBranch(hospitalId, { name, address, phone, email }) {
    const validationError = validateFields({ name, address, phone, email }, { partial: false });
    if (validationError) return { error: 'VALIDATION', message: validationError };

    const cleanName = name.trim();
    if (await nameExistsInHospital(hospitalId, cleanName)) return { error: 'DUPLICATE_NAME' };

    const [result] = await db.query(
        'INSERT INTO branches (hospital_id, name, address, phone, email, is_active) VALUES (?, ?, ?, ?, ?, TRUE)',
        [hospitalId, cleanName, address.trim(), (phone || '').trim() || null, (email || '').trim() || null]
    );
    return { id: result.insertId };
}

async function updateBranch(hospitalId, branchId, { name, address, phone, email }) {
    const existing = await getBranch(hospitalId, branchId);
    if (!existing) return { error: 'NOT_FOUND' };

    const validationError = validateFields({ name, address, phone, email }, { partial: true });
    if (validationError) return { error: 'VALIDATION', message: validationError };

    const cleanName = name !== undefined ? name.trim() : existing.name;
    if (cleanName !== existing.name && await nameExistsInHospital(hospitalId, cleanName, branchId)) {
        return { error: 'DUPLICATE_NAME' };
    }

    await db.query(
        'UPDATE branches SET name = ?, address = ?, phone = ?, email = ? WHERE id = ?',
        [
            cleanName,
            address !== undefined ? address.trim() : existing.address,
            phone !== undefined ? ((phone || '').trim() || null) : existing.phone,
            email !== undefined ? ((email || '').trim() || null) : existing.email,
            branchId
        ]
    );
    return { id: Number(branchId) };
}

async function countActiveDepartments(branchId) {
    const [[{ cnt }]] = await db.query(
        "SELECT COUNT(*) AS cnt FROM departments WHERE branch_id = ? AND status = 'Active'",
        [branchId]
    );
    return cnt;
}

async function setActive(hospitalId, branchId, isActive) {
    const existing = await getBranch(hospitalId, branchId);
    if (!existing) return { error: 'NOT_FOUND' };
    if (!!existing.is_active === isActive) return { id: Number(branchId), status: toStatus(isActive) };

    await db.query('UPDATE branches SET is_active = ? WHERE id = ?', [isActive, branchId]);
    return { id: Number(branchId), status: toStatus(isActive) };
}

// A branch with active departments still under it can't be archived —
// mirrors departmentAdminService.archiveDepartment's own reasoning exactly
// (an archived branch would orphan its still-active departments from the
// admin's ability to reach them via a "real" branch). Only Active departments
// count: a department that's already archived isn't a live dependency
// blocking the branch from also going dormant. Same shared dependencyGuard
// helper, same error shape, ready for any future module to reuse the same way.
async function archiveBranch(hospitalId, branchId) {
    const existing = await getBranch(hospitalId, branchId);
    if (!existing) return { error: 'NOT_FOUND' };
    if (!existing.is_active) return { id: Number(branchId), status: 'Inactive' };

    const departmentCount = await countActiveDepartments(branchId);
    const blocked = dependencyGuard.blockIfInUse(departmentCount);
    if (blocked) return blocked;

    return setActive(hospitalId, branchId, false);
}

const restoreBranch = (hospitalId, branchId) => setActive(hospitalId, branchId, true);

module.exports = { listBranches, getBranch, createBranch, updateBranch, archiveBranch, restoreBranch };
