const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { isValidEmail, isValidPhone, isStrongEnoughPassword, cleanOptional, isNonEmpty } = require('../validators/validators');

const HOSPITAL_STATUSES = ['Active', 'Suspended'];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const SEARCH_LIMIT = 10;

function parseDetails(row) {
    if (!row.details) return { ...row, details: null };
    return { ...row, details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details };
}

// ==================== Audit ====================
// The one shared writer every platform action (and, as of Stage 4B, every
// hospital-admin login too) goes through — same "single shared audit
// service" discipline as appointmentStateMachine's appointment_status_history
// writes, applied to the platform's own domain. actorType/hospitalAdminId
// let this same table log a hospital admin's own login alongside platform
// actions (see database/schema.sql's comment on platform_audit_log) — exactly one
// of platformAdminId/hospitalAdminId should be set per call, matching actorType.
async function recordAudit({
    actorType = 'PlatformAdmin', platformAdminId = null, hospitalAdminId = null, actorName = null,
    actionType, hospitalId = null, hospitalName = null, details = null,
    ipAddress = null, userAgent = null, sessionId = null
}) {
    await db.query(
        `INSERT INTO platform_audit_log
         (actor_type, platform_admin_id, hospital_admin_id, actor_name, action_type, hospital_id, hospital_name, details, ip_address, user_agent, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [actorType, platformAdminId, hospitalAdminId, actorName, actionType, hospitalId, hospitalName,
            details ? JSON.stringify(details) : null, ipAddress, userAgent, sessionId]
    );
}

// Doubles as the Platform Activity Feed's data source (Stage 4B) — same
// newest-first table, no separate feed storage; the frontend just renders it
// with friendlier labels/icons per action_type.
async function listAuditLog({ hospitalId, actionType, limit, offset } = {}) {
    const params = [];
    let where = '1=1';
    if (hospitalId) { where += ' AND hospital_id = ?'; params.push(hospitalId); }
    if (actionType) { where += ' AND action_type = ?'; params.push(actionType); }
    const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
    const off = Math.max(0, parseInt(offset, 10) || 0);

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM platform_audit_log WHERE ${where}`, params);
    const [rows] = await db.query(
        `SELECT * FROM platform_audit_log WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, lim, off]
    );
    return { entries: rows.map(parseDetails), total };
}

// ==================== Health score (Stage 4B) ====================
// Pure function over already-fetched counts — never issues its own queries,
// so calling it once per row of an already-batched result set (listHospitals)
// or once for a single hospital (getHospitalDetail) is O(1) extra DB work
// either way, not a new N+1.
const HEALTH_WARNING_CHECKS = [
    { key: 'noBranch', label: 'No Branch', test: c => c.branchCount === 0 },
    { key: 'noDepartment', label: 'No Department', test: c => c.departmentCount === 0 },
    { key: 'noDoctor', label: 'No Doctor', test: c => c.doctorCount === 0 },
    { key: 'noStaff', label: 'No Staff', test: c => c.staffCount === 0 },
    { key: 'whatsappNotConnected', label: 'WhatsApp Not Connected', test: c => !c.hasWhatsapp },
    { key: 'noOperatingHours', label: 'No Operating Hours', test: c => c.noOperatingHours },
    { key: 'noRecentAppointments', label: 'No Appointments in Last 30 Days', test: c => c.recentAppointmentCount === 0 }
];

function computeHealth(counts) {
    const warnings = HEALTH_WARNING_CHECKS.filter(w => w.test(counts)).map(w => w.label);
    let status = 'Healthy';
    if (warnings.length >= 3) status = 'Critical';
    else if (warnings.length >= 1) status = 'Warning';
    return { status, warnings };
}

// ==================== Dashboard ====================
// The one deliberate, unscoped cross-hospital aggregate in this codebase —
// appropriate here specifically because a platform admin has no hospital_id
// of their own by construction (see platform_admins' schema comment), so
// "unscoped" is the correct scope for this identity, not a leak.
async function getPlatformDashboardStats() {
    const [[hospitalStats]] = await db.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'Active') AS active,
                COUNT(*) FILTER (WHERE status = 'Suspended') AS suspended,
                COUNT(*) FILTER (WHERE whatsapp_business_phone_id IS NOT NULL) AS whatsapp_connected
         FROM hospitals`
    );
    const [[doctorStats]] = await db.query('SELECT COUNT(*) AS total FROM doctors');
    const [[staffStats]] = await db.query('SELECT COUNT(*) AS total FROM admin_users');
    const [[patientStats]] = await db.query('SELECT COUNT(*) AS total FROM patients');
    const [[appointmentStats]] = await db.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE appointment_date = CURRENT_DATE) AS today,
                COUNT(*) FILTER (WHERE appointment_date BETWEEN DATE_TRUNC('month', CURRENT_DATE) AND CURRENT_DATE) AS this_month
         FROM appointments`
    );
    const [[needsWhatsApp]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM hospitals WHERE status = 'Active' AND whatsapp_business_phone_id IS NULL`
    );
    // "Pending Setup" (dashboard card) and "no doctors yet" (system-health
    // warning) are the same underlying fact — one query, two labels — rather
    // than running the identical NOT EXISTS scan twice.
    const [[noDoctors]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM hospitals h
         WHERE h.status = 'Active' AND NOT EXISTS (
             SELECT 1 FROM doctors doc
             JOIN departments dep ON dep.id = doc.department_id
             JOIN branches b ON b.id = dep.branch_id
             WHERE b.hospital_id = h.id
         )`
    );

    return {
        hospitals: {
            total: hospitalStats.total,
            active: Number(hospitalStats.active) || 0,
            suspended: Number(hospitalStats.suspended) || 0,
            pendingSetup: noDoctors.cnt
        },
        totalDoctors: doctorStats.total,
        totalStaff: staffStats.total,
        totalPatients: patientStats.total,
        totalAppointments: appointmentStats.total,
        todayAppointments: Number(appointmentStats.today) || 0,
        monthAppointments: Number(appointmentStats.this_month) || 0,
        activeWhatsAppConnections: Number(hospitalStats.whatsapp_connected) || 0,
        // Grounded in real, queryable facts rather than fabricated metrics —
        // no logging/metrics infrastructure exists in this app to report
        // anything richer (error rates, latency) honestly.
        systemHealth: {
            database: 'Connected',
            serverUptimeSeconds: Math.floor(process.uptime()),
            hospitalsNeedingWhatsAppSetup: needsWhatsApp.cnt,
            hospitalsWithNoDoctors: noDoctors.cnt
        }
    };
}

// ==================== Hospital management ====================

async function listHospitals({ search, status, page, pageSize } = {}) {
    const params = [];
    let where = '1=1';
    if (search) {
        const like = `%${search}%`;
        where += ' AND (h.name ILIKE ? OR h.email ILIKE ? OR h.city ILIKE ?)';
        params.push(like, like, like);
    }
    if (status && HOSPITAL_STATUSES.includes(status)) {
        where += ' AND h.status = ?';
        params.push(status);
    }

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM hospitals h WHERE ${where}`, params);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, Math.min(MAX_PAGE_SIZE, parseInt(pageSize, 10) || DEFAULT_PAGE_SIZE));
    const offset = (pageNum - 1) * size;

    // Every *_count/has_* column below is a correlated subquery scoped to
    // this one hospital row — MySQL runs these against the already-paginated
    // (LIMIT'd) result, so this is one round trip total regardless of how
    // many hospitals exist, not a per-row query from Node (the actual N+1
    // pattern the Stage 3.5 performance review flagged elsewhere).
    const [rows] = await db.query(
        `SELECT h.id, h.name, h.email, h.phone, h.city, h.state, h.status, h.whatsapp_business_phone_id, h.created_at,
                h.morning_start, h.afternoon_start, h.evening_start,
                (SELECT COUNT(*) FROM branches b WHERE b.hospital_id = h.id) AS branch_count,
                (SELECT COUNT(*) FROM admin_users au WHERE au.hospital_id = h.id) AS staff_count,
                (SELECT COUNT(*) FROM departments dep JOIN branches b2 ON b2.id = dep.branch_id WHERE b2.hospital_id = h.id) AS department_count,
                (SELECT COUNT(*) FROM doctors doc JOIN departments dep2 ON dep2.id = doc.department_id JOIN branches b3 ON b3.id = dep2.branch_id WHERE b3.hospital_id = h.id) AS doctor_count,
                (SELECT COUNT(*) FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE p.hospital_id = h.id AND a.appointment_date >= CURRENT_DATE - INTERVAL '30 days') AS recent_appointment_count
         FROM hospitals h WHERE ${where}
         ORDER BY h.created_at DESC LIMIT ? OFFSET ?`,
        [...params, size, offset]
    );

    return {
        hospitals: rows.map(r => {
            const hasWhatsapp = !!r.whatsapp_business_phone_id;
            const health = computeHealth({
                branchCount: r.branch_count, departmentCount: r.department_count, doctorCount: r.doctor_count,
                staffCount: r.staff_count, hasWhatsapp,
                noOperatingHours: !r.morning_start && !r.afternoon_start && !r.evening_start,
                recentAppointmentCount: r.recent_appointment_count
            });
            const { morning_start, afternoon_start, evening_start, ...rest } = r;
            return { ...rest, hasWhatsapp, health };
        }),
        pagination: { page: pageNum, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)) }
    };
}

async function getHospitalDetail(hospitalId) {
    const [rows] = await db.query('SELECT * FROM hospitals WHERE id = ?', [hospitalId]);
    const hospital = rows[0];
    if (!hospital) return null;

    const [branches] = await db.query(
        'SELECT id, name, address, phone, is_active FROM branches WHERE hospital_id = ? ORDER BY id', [hospitalId]
    );
    const [departments] = await db.query(
        `SELECT dep.id, dep.name_en, dep.status, b.name AS branch_name
         FROM departments dep JOIN branches b ON b.id = dep.branch_id
         WHERE b.hospital_id = ? ORDER BY dep.id`,
        [hospitalId]
    );
    const [doctors] = await db.query(
        `SELECT doc.id, doc.name, doc.is_on_leave, dep.name_en AS department_name
         FROM doctors doc JOIN departments dep ON dep.id = doc.department_id JOIN branches b ON b.id = dep.branch_id
         WHERE b.hospital_id = ? ORDER BY doc.id`,
        [hospitalId]
    );
    const [[patientCount]] = await db.query('SELECT COUNT(*) AS cnt FROM patients WHERE hospital_id = ?', [hospitalId]);
    const [recentPatients] = await db.query(
        'SELECT id, name, phone_number, uhid, created_at FROM patients WHERE hospital_id = ? ORDER BY created_at DESC LIMIT 10',
        [hospitalId]
    );
    const [[appt]] = await db.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE a.appointment_date = CURRENT_DATE) AS today,
                COUNT(*) FILTER (WHERE a.appointment_date BETWEEN DATE_TRUNC('month', CURRENT_DATE) AND CURRENT_DATE) AS this_month,
                COUNT(*) FILTER (WHERE a.status = 'Confirmed') AS confirmed, COUNT(*) FILTER (WHERE a.status = 'Completed') AS completed,
                COUNT(*) FILTER (WHERE a.status = 'Cancelled') AS cancelled,
                COUNT(*) FILTER (WHERE a.appointment_date >= CURRENT_DATE - INTERVAL '30 days') AS recent30
         FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE p.hospital_id = ?`,
        [hospitalId]
    );
    const [staff] = await db.query(
        'SELECT id, name, email, role, phone_number, created_at FROM admin_users WHERE hospital_id = ? ORDER BY created_at ASC',
        [hospitalId]
    );
    const [recentAudit] = await db.query(
        'SELECT * FROM platform_audit_log WHERE hospital_id = ? ORDER BY created_at DESC LIMIT 15',
        [hospitalId]
    );

    const health = computeHealth({
        branchCount: branches.length, departmentCount: departments.length, doctorCount: doctors.length,
        staffCount: staff.length, hasWhatsapp: !!hospital.whatsapp_business_phone_id,
        noOperatingHours: !hospital.morning_start && !hospital.afternoon_start && !hospital.evening_start,
        recentAppointmentCount: Number(appt.recent30) || 0
    });

    return {
        hospital,
        health,
        stats: {
            branchCount: branches.length, departmentCount: departments.length, doctorCount: doctors.length,
            staffCount: staff.length, patientCount: patientCount.cnt, appointmentCount: appt.total
        },
        branches, departments, doctors,
        patients: { total: patientCount.cnt, recent: recentPatients },
        appointmentsSummary: {
            total: appt.total, today: Number(appt.today) || 0, thisMonth: Number(appt.this_month) || 0,
            confirmed: Number(appt.confirmed) || 0, completed: Number(appt.completed) || 0, cancelled: Number(appt.cancelled) || 0
        },
        // Subscriptions/billing are explicitly out of scope for this stage —
        // this is a placeholder shape only, not backed by any real plan_tier
        // column or enforcement logic.
        subscription: { planTier: 'Free', billingStatus: 'Not enabled', note: 'Subscriptions and billing are planned for a future stage.' },
        staff,
        recentAudit: recentAudit.map(parseDetails)
    };
}

function validateCreateHospital(body) {
    const required = [
        ['name', 'Hospital name'], ['email', 'Hospital email'], ['phone', 'Hospital phone'],
        ['admin_name', 'Admin name'], ['admin_email', 'Admin email'], ['admin_password', 'Admin password']
    ];
    for (const [field, label] of required) {
        if (!isNonEmpty(body[field])) return `${label} is required`;
    }
    if (!isValidEmail(body.email)) return 'Hospital email is not a valid email address';
    if (!isValidEmail(body.admin_email)) return 'Admin email is not a valid email address';
    if (!isValidPhone(body.phone)) return 'Hospital phone number must be 10-15 digits';
    if (!isStrongEnoughPassword(body.admin_password)) {
        return 'Admin password must be at least 8 characters and include at least 3 of: lowercase, uppercase, number, symbol';
    }
    return null;
}

// Platform-side hospital creation is intentionally its own function, not a
// call into hospitalRegistrationService.registerHospital — that service is
// the public self-registration flow (Terms-agreement checkbox, logo upload,
// full address form) and is explicitly out of scope to touch this stage.
// Same end result either way though: a hospital row + its first
// 'Super Admin'-rank admin_users account, in one transaction, matching
// self-registration's own precedent for what the first/owner account's rank
// should be.
async function createHospital(body, platformAdminId, platformAdminName, requestMeta = {}) {
    const validationError = validateCreateHospital(body);
    if (validationError) return { error: validationError };

    const adminEmail = body.admin_email.trim().toLowerCase();
    const [existing] = await db.query('SELECT id FROM admin_users WHERE email = ?', [adminEmail]);
    if (existing[0]) return { error: 'An account with this admin email already exists' };

    const conn = await db.getConnection();
    let hospitalId;
    try {
        await conn.beginTransaction();

        const [hospitalResult] = await conn.query(
            `INSERT INTO hospitals (name, email, phone, address, city, state, country, pincode, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
            [
                body.name.trim(), body.email.trim().toLowerCase(), body.phone.trim(),
                cleanOptional(body.address), cleanOptional(body.city), cleanOptional(body.state),
                cleanOptional(body.country) || 'India', cleanOptional(body.pincode)
            ]
        );
        hospitalId = hospitalResult.insertId;

        const passwordHash = await bcrypt.hash(body.admin_password, 10);
        await conn.query(
            `INSERT INTO admin_users (hospital_id, email, password_hash, name, role, phone_number)
             VALUES (?, ?, ?, ?, 'Super Admin', ?)`,
            [hospitalId, adminEmail, passwordHash, body.admin_name.trim(), cleanOptional(body.admin_phone)]
        );

        await conn.commit();
    } catch (err) {
        await conn.rollback();
        if (err.code === 'ER_DUP_ENTRY') return { error: 'An account with this admin email already exists' };
        throw err;
    } finally {
        conn.release();
    }

    // Deliberately outside the transaction/try block above: the hospital is
    // already durably committed by this point, so a failure writing the
    // audit entry must never turn a real success into a 500 (this was the
    // exact bug the Stage 4B schema change briefly introduced — recordAudit
    // used to run *inside* the try block, so its own failure triggered the
    // catch's rollback-and-rethrow path even after a successful commit).
    try {
        await recordAudit({
            actorType: 'PlatformAdmin', platformAdminId, actorName: platformAdminName, actionType: 'HospitalCreated',
            hospitalId, hospitalName: body.name.trim(), details: { adminEmail },
            ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent, sessionId: requestMeta.sessionId
        });
    } catch (err) {
        console.error('Failed to write HospitalCreated audit entry:', err);
    }

    return { hospitalId };
}

// status/plan are deliberately not editable here — status has its own
// dedicated, separately-audited action below, and plan-tier doesn't exist
// yet (subscriptions/billing are out of scope for this stage).
async function updateHospital(hospitalId, body, platformAdminId, platformAdminName, requestMeta = {}) {
    const [rows] = await db.query('SELECT * FROM hospitals WHERE id = ?', [hospitalId]);
    const before = rows[0];
    if (!before) return { error: 'NOT_FOUND' };

    if (body.name !== undefined && !isNonEmpty(body.name)) return { error: 'Hospital name cannot be empty' };
    if (body.email !== undefined && !isValidEmail(body.email)) return { error: 'Hospital email is not valid' };
    if (body.phone !== undefined && !isValidPhone(body.phone)) return { error: 'Hospital phone must be 10-15 digits' };

    const next = {
        name: body.name !== undefined ? body.name.trim() : before.name,
        email: body.email !== undefined ? body.email.trim().toLowerCase() : before.email,
        phone: body.phone !== undefined ? body.phone.trim() : before.phone,
        address: body.address !== undefined ? cleanOptional(body.address) : before.address,
        city: body.city !== undefined ? cleanOptional(body.city) : before.city,
        state: body.state !== undefined ? cleanOptional(body.state) : before.state,
        country: body.country !== undefined ? (cleanOptional(body.country) || 'India') : before.country,
        pincode: body.pincode !== undefined ? cleanOptional(body.pincode) : before.pincode
    };

    await db.query(
        `UPDATE hospitals SET name=?, email=?, phone=?, address=?, city=?, state=?, country=?, pincode=? WHERE id = ?`,
        [next.name, next.email, next.phone, next.address, next.city, next.state, next.country, next.pincode, hospitalId]
    );

    const changes = {};
    for (const field of Object.keys(next)) {
        if (next[field] !== before[field]) changes[field] = { from: before[field], to: next[field] };
    }

    try {
        await recordAudit({
            actorType: 'PlatformAdmin', platformAdminId, actorName: platformAdminName, actionType: 'HospitalEdited',
            hospitalId, hospitalName: next.name, details: { changes },
            ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent, sessionId: requestMeta.sessionId
        });
    } catch (err) {
        console.error('Failed to write HospitalEdited audit entry:', err);
    }

    return { success: true };
}

async function setHospitalStatus(hospitalId, status, platformAdminId, platformAdminName, requestMeta = {}) {
    if (!HOSPITAL_STATUSES.includes(status)) return { error: 'INVALID_STATUS' };

    const [rows] = await db.query('SELECT id, name, status FROM hospitals WHERE id = ?', [hospitalId]);
    const hospital = rows[0];
    if (!hospital) return { error: 'NOT_FOUND' };
    if (hospital.status === status) return { error: status === 'Suspended' ? 'ALREADY_SUSPENDED' : 'ALREADY_ACTIVE' };

    await db.query('UPDATE hospitals SET status = ? WHERE id = ?', [status, hospitalId]);

    try {
        await recordAudit({
            actorType: 'PlatformAdmin', platformAdminId, actorName: platformAdminName,
            actionType: status === 'Suspended' ? 'HospitalSuspended' : 'HospitalActivated',
            hospitalId, hospitalName: hospital.name,
            ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent, sessionId: requestMeta.sessionId
        });
    } catch (err) {
        console.error(`Failed to write Hospital${status === 'Suspended' ? 'Suspended' : 'Activated'} audit entry:`, err);
    }

    return { success: true, status };
}

// ==================== Global search (Stage 4B) ====================
// Platform-only — this is a completely separate query/route from the
// hospital-admin panel's own global search (topbar.js's runGlobalSearch,
// which stays scoped to req.admin.hospital_id and is untouched by this
// stage). Each category capped at SEARCH_LIMIT; four small independent
// queries run together rather than one another to reduce round trips.
async function globalSearch(query) {
    const q = (query || '').trim();
    if (q.length < 2) return { hospitals: [], doctors: [], patients: [], staff: [] };
    const like = `%${q}%`;

    const [[hospitals], [doctors], [patients], [staff]] = await Promise.all([
        db.query(
            `SELECT id, name, city, status FROM hospitals
             WHERE name ILIKE ? OR email ILIKE ? OR city ILIKE ? LIMIT ${SEARCH_LIMIT}`,
            [like, like, like]
        ),
        db.query(
            `SELECT doc.id, doc.name, doc.is_on_leave, dep.name_en AS department_name, b.name AS branch_name,
                    h.id AS hospital_id, h.name AS hospital_name
             FROM doctors doc
             JOIN departments dep ON dep.id = doc.department_id
             JOIN branches b ON b.id = dep.branch_id
             JOIN hospitals h ON h.id = b.hospital_id
             WHERE doc.name ILIKE ? LIMIT ${SEARCH_LIMIT}`,
            [like]
        ),
        db.query(
            `SELECT p.id, p.name, p.phone_number, p.uhid, h.id AS hospital_id, h.name AS hospital_name
             FROM patients p JOIN hospitals h ON h.id = p.hospital_id
             WHERE p.name ILIKE ? OR p.phone_number ILIKE ? OR p.uhid ILIKE ? LIMIT ${SEARCH_LIMIT}`,
            [like, like, like]
        ),
        db.query(
            `SELECT au.id, au.name, au.email, au.role, h.id AS hospital_id, h.name AS hospital_name
             FROM admin_users au JOIN hospitals h ON h.id = au.hospital_id
             WHERE au.name ILIKE ? OR au.email ILIKE ? LIMIT ${SEARCH_LIMIT}`,
            [like, like]
        )
    ]);

    return {
        hospitals: hospitals.map(h => ({ type: 'hospital', id: h.id, name: h.name, hospital: h.name, branch: null, department: null, status: h.status })),
        doctors: doctors.map(d => ({
            type: 'doctor', id: d.id, name: d.name, hospital: d.hospital_name, hospitalId: d.hospital_id,
            branch: d.branch_name, department: d.department_name, status: d.is_on_leave ? 'On Leave' : 'Active'
        })),
        patients: patients.map(p => ({
            type: 'patient', id: p.id, name: p.name, hospital: p.hospital_name, hospitalId: p.hospital_id,
            branch: null, department: null, status: p.uhid || p.phone_number
        })),
        staff: staff.map(s => ({
            type: 'staff', id: s.id, name: s.name, hospital: s.hospital_name, hospitalId: s.hospital_id,
            branch: null, department: null, status: s.role
        }))
    };
}

// ==================== Platform settings (Stage 4B, read-only) ====================
async function getPlatformSettings() {
    const packageJson = require('../../../package.json');
    const [[dbVersion]] = await db.query('SELECT VERSION() AS v');
    const [[storage]] = await db.query(
        `SELECT pg_database_size(current_database()) AS bytes`
    );
    const [[hospitalCount]] = await db.query('SELECT COUNT(*) AS cnt FROM hospitals');
    const [[userCount]] = await db.query('SELECT COUNT(*) AS cnt FROM admin_users');

    const bytes = Number(storage.bytes) || 0;
    const totalStorageUsed = bytes >= 1024 * 1024 * 1024
        ? `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
        : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

    return {
        platformVersion: packageJson.version,
        databaseVersion: dbVersion.v,
        environment: process.env.NODE_ENV || 'development',
        totalStorageUsed,
        totalHospitals: hospitalCount.cnt,
        totalUsers: userCount.cnt,
        futureBillingStatus: 'Not enabled — subscriptions and billing are planned for a future stage.'
    };
}

module.exports = {
    recordAudit,
    listAuditLog,
    getPlatformDashboardStats,
    listHospitals,
    getHospitalDetail,
    createHospital,
    updateHospital,
    setHospitalStatus,
    globalSearch,
    getPlatformSettings
};
