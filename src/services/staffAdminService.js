const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { isValidEmail } = require('../utils/validators');

const ROLES = ['Hospital Administrator', 'Receptionist', 'Super Admin'];
// A hospital left with zero accounts at this rank or above can never manage
// staff/settings/doctors again (every write route is requireRole('Hospital
// Administrator')) — so role changes/deletes that would drop the count to
// zero are blocked below, the same "don't create an unrecoverable state"
// reasoning as doctorAdminService.deleteDoctor blocking on in-use appointments.
const ADMIN_RANK_ROLES = ['Hospital Administrator', 'Super Admin'];

async function listStaff(hospitalId) {
    const [rows] = await db.query(
        `SELECT id, name, email, role, phone_number, created_at
         FROM admin_users WHERE hospital_id = ? ORDER BY created_at ASC`,
        [hospitalId]
    );
    return rows;
}

async function countAdminRankStaff(hospitalId, excludeId) {
    const params = [hospitalId, ADMIN_RANK_ROLES];
    let sql = 'SELECT COUNT(*) AS cnt FROM admin_users WHERE hospital_id = ? AND role IN (?)';
    if (excludeId != null) {
        sql += ' AND id != ?';
        params.push(excludeId);
    }
    const [[{ cnt }]] = await db.query(sql, params);
    return cnt;
}

async function createStaff(hospitalId, { name, email, password, role, phone_number }) {
    if (!name || !email || !password || !role) {
        return { error: 'name, email, password, and role are all required' };
    }
    if (!isValidEmail(email)) return { error: 'Not a valid email address' };
    if (!ROLES.includes(role)) return { error: `role must be one of: ${ROLES.join(', ')}` };
    if (password.length < 6) return { error: 'Password must be at least 6 characters' };

    const cleanEmail = email.trim().toLowerCase();
    const [existing] = await db.query('SELECT id FROM admin_users WHERE email = ?', [cleanEmail]);
    if (existing[0]) return { error: 'An account with this email already exists' };

    const hash = await bcrypt.hash(password, 10);
    try {
        const [result] = await db.query(
            'INSERT INTO admin_users (hospital_id, email, password_hash, name, role, phone_number) VALUES (?, ?, ?, ?, ?, ?)',
            [hospitalId, cleanEmail, hash, name.trim(), role, phone_number || null]
        );
        return { id: result.insertId };
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return { error: 'An account with this email already exists' };
        throw err;
    }
}

// actingAdminId: whoever is making this call (req.admin.id) — a staff member
// can never change their OWN role through this endpoint (that's exactly the
// self-escalation hole this endpoint replaces; role changes now require a
// *different* Hospital-Administrator-rank staff member to make them).
async function updateStaffRole(hospitalId, staffId, newRole, actingAdminId) {
    if (!ROLES.includes(newRole)) return { error: 'INVALID_ROLE' };
    if (String(staffId) === String(actingAdminId)) return { error: 'CANNOT_CHANGE_OWN_ROLE' };

    const [rows] = await db.query('SELECT id, role FROM admin_users WHERE id = ? AND hospital_id = ?', [staffId, hospitalId]);
    const staff = rows[0];
    if (!staff) return { error: 'NOT_FOUND' };

    const wasAdminRank = ADMIN_RANK_ROLES.includes(staff.role);
    const willBeAdminRank = ADMIN_RANK_ROLES.includes(newRole);
    if (wasAdminRank && !willBeAdminRank) {
        const remaining = await countAdminRankStaff(hospitalId, staffId);
        if (remaining === 0) return { error: 'LAST_ADMIN' };
    }

    await db.query('UPDATE admin_users SET role = ? WHERE id = ?', [newRole, staffId]);
    return { id: Number(staffId), role: newRole };
}

async function deleteStaff(hospitalId, staffId, actingAdminId) {
    if (String(staffId) === String(actingAdminId)) return { error: 'CANNOT_DELETE_SELF' };

    const [rows] = await db.query('SELECT id, role FROM admin_users WHERE id = ? AND hospital_id = ?', [staffId, hospitalId]);
    const staff = rows[0];
    if (!staff) return { error: 'NOT_FOUND' };

    if (ADMIN_RANK_ROLES.includes(staff.role)) {
        const remaining = await countAdminRankStaff(hospitalId, staffId);
        if (remaining === 0) return { error: 'LAST_ADMIN' };
    }

    await db.query('DELETE FROM admin_users WHERE id = ?', [staffId]);
    return { deleted: true };
}

module.exports = { listStaff, createStaff, updateStaffRole, deleteStaff, ROLES };
