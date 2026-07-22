const db = require('../config/db');
const { formatDate } = require('../rule_engine/messages');

const PLAN_LIMIT_FIELDS = ['max_branches', 'max_departments', 'max_doctors', 'max_staff', 'max_monthly_appointments', 'max_monthly_whatsapp_conversations'];
const PLAN_BOOLEAN_FIELDS = ['reports_module', 'reception_module', 'analytics_module', 'api_access', 'multi_branch_support'];
const PLAN_STATUSES = ['Active', 'Archived'];
const SUBSCRIPTION_BASE_STATUSES = ['Trial', 'Active', 'Suspended'];

// Single canonical source of truth for "what is this hospital's subscription
// status right now" — entirely SQL-side (every comparison is a DATE column
// against CURRENT_DATE, never a JS Date object), used identically by the list
// endpoint (so filtering/pagination stay server-side, not fetch-all-then-
// filter-in-JS) and the single-hospital detail endpoint, so there is exactly
// one implementation of this logic, not two that could drift apart.
// hospitals.subscription_status only ever stores 'Trial'/'Active'/'Suspended'
// (the three admin-settable base states, see db/schema.sql's comment on that
// column) — 'Grace Period' and 'Expired' only ever exist as this derived value.
const EFFECTIVE_STATUS_SQL = `
    CASE
        WHEN h.plan_id IS NULL THEN 'No Plan Assigned'
        WHEN h.subscription_status = 'Suspended' THEN 'Suspended'
        WHEN h.subscription_status = 'Trial' THEN
            CASE
                WHEN h.trial_end_date IS NULL OR h.trial_end_date >= CURRENT_DATE THEN 'Trial'
                WHEN h.grace_period_end IS NOT NULL AND h.grace_period_end >= CURRENT_DATE THEN 'Grace Period'
                ELSE 'Expired'
            END
        ELSE
            CASE
                WHEN h.subscription_end IS NULL OR h.subscription_end >= CURRENT_DATE THEN 'Active'
                WHEN h.grace_period_end IS NOT NULL AND h.grace_period_end >= CURRENT_DATE THEN 'Grace Period'
                ELSE 'Expired'
            END
    END
`;

function parseDetails(row) {
    if (!row.details) return { ...row, details: null };
    return { ...row, details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details };
}

// ==================== Audit ====================
// Deliberately a separate table/writer from platformAdminService.recordAudit
// (Stage 4B) rather than an ALTER on that already-shipped table — Stage 4B
// is explicitly frozen this stage. Same conventions throughout regardless.
async function recordAudit({
    platformAdminId = null, actorName = null, actionType,
    hospitalId = null, hospitalName = null, planId = null, planName = null,
    details = null, ipAddress = null, userAgent = null, sessionId = null
}) {
    await db.query(
        `INSERT INTO subscription_audit_log
         (platform_admin_id, actor_name, action_type, hospital_id, hospital_name, plan_id, plan_name, details, ip_address, user_agent, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [platformAdminId, actorName, actionType, hospitalId, hospitalName, planId, planName,
            details ? JSON.stringify(details) : null, ipAddress, userAgent, sessionId]
    );
}

async function listSubscriptionAuditLog({ hospitalId, actionType, limit, offset } = {}) {
    const params = [];
    let where = '1=1';
    if (hospitalId) { where += ' AND hospital_id = ?'; params.push(hospitalId); }
    if (actionType) { where += ' AND action_type = ?'; params.push(actionType); }
    const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
    const off = Math.max(0, parseInt(offset, 10) || 0);

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM subscription_audit_log WHERE ${where}`, params);
    const [rows] = await db.query(
        `SELECT * FROM subscription_audit_log WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, lim, off]
    );
    return { entries: rows.map(parseDetails), total };
}

// ==================== Plan management ====================

function normalizeLimitValue(v) {
    if (v === undefined || v === null || v === '') return null; // null = unlimited throughout
    return Number(v);
}

function validatePlanBody(body) {
    if (!body.name || !String(body.name).trim()) return 'Plan name is required';
    for (const field of PLAN_LIMIT_FIELDS) {
        const v = body[field];
        if (v !== undefined && v !== null && v !== '') {
            const n = Number(v);
            if (!Number.isInteger(n) || n < 0) return `${field.replace(/_/g, ' ')} must be a non-negative whole number, or left blank for unlimited`;
        }
    }
    return null;
}

async function listPlans({ status, page, pageSize } = {}) {
    const params = [];
    let where = '1=1';
    if (status && PLAN_STATUSES.includes(status)) { where += ' AND status = ?'; params.push(status); }

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM subscription_plans WHERE ${where}`, params);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 20));
    const offset = (pageNum - 1) * size;

    const [rows] = await db.query(
        `SELECT sp.*, (SELECT COUNT(*) FROM hospitals h WHERE h.plan_id = sp.id) AS hospital_count
         FROM subscription_plans sp WHERE ${where}
         ORDER BY sp.id ASC LIMIT ? OFFSET ?`,
        [...params, size, offset]
    );
    return { plans: rows, pagination: { page: pageNum, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)) } };
}

async function getPlan(planId) {
    const [rows] = await db.query('SELECT * FROM subscription_plans WHERE id = ?', [planId]);
    return rows[0] || null;
}

async function createPlan(body, platformAdminId, actorName, requestMeta = {}) {
    const validationError = validatePlanBody(body);
    if (validationError) return { error: validationError };

    const v = {
        name: String(body.name).trim(),
        max_branches: normalizeLimitValue(body.max_branches),
        max_departments: normalizeLimitValue(body.max_departments),
        max_doctors: normalizeLimitValue(body.max_doctors),
        max_staff: normalizeLimitValue(body.max_staff),
        max_monthly_appointments: normalizeLimitValue(body.max_monthly_appointments),
        max_monthly_whatsapp_conversations: normalizeLimitValue(body.max_monthly_whatsapp_conversations),
        reports_module: !!body.reports_module,
        reception_module: !!body.reception_module,
        analytics_module: !!body.analytics_module,
        api_access: !!body.api_access,
        multi_branch_support: !!body.multi_branch_support
    };

    const [result] = await db.query(
        `INSERT INTO subscription_plans
         (name, max_branches, max_departments, max_doctors, max_staff, max_monthly_appointments, max_monthly_whatsapp_conversations,
          reports_module, reception_module, analytics_module, api_access, multi_branch_support)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.name, v.max_branches, v.max_departments, v.max_doctors, v.max_staff, v.max_monthly_appointments, v.max_monthly_whatsapp_conversations,
            v.reports_module, v.reception_module, v.analytics_module, v.api_access, v.multi_branch_support]
    );

    try {
        await recordAudit({
            platformAdminId, actorName, actionType: 'PlanCreated', planId: result.insertId, planName: v.name,
            details: v, ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent, sessionId: requestMeta.sessionId
        });
    } catch (err) { console.error('Failed to write PlanCreated audit entry:', err); }

    return { id: result.insertId };
}

async function updatePlan(planId, body, platformAdminId, actorName, requestMeta = {}) {
    const existing = await getPlan(planId);
    if (!existing) return { error: 'NOT_FOUND' };

    const validationError = validatePlanBody({ ...existing, ...body });
    if (validationError) return { error: validationError };

    const next = { name: body.name !== undefined ? String(body.name).trim() : existing.name };
    for (const field of PLAN_LIMIT_FIELDS) {
        next[field] = body[field] !== undefined ? normalizeLimitValue(body[field]) : existing[field];
    }
    for (const field of PLAN_BOOLEAN_FIELDS) {
        next[field] = body[field] !== undefined ? !!body[field] : !!existing[field];
    }

    await db.query(
        `UPDATE subscription_plans SET
            name=?, max_branches=?, max_departments=?, max_doctors=?, max_staff=?,
            max_monthly_appointments=?, max_monthly_whatsapp_conversations=?,
            reports_module=?, reception_module=?, analytics_module=?, api_access=?, multi_branch_support=?
         WHERE id = ?`,
        [next.name, next.max_branches, next.max_departments, next.max_doctors, next.max_staff,
            next.max_monthly_appointments, next.max_monthly_whatsapp_conversations,
            next.reports_module, next.reception_module, next.analytics_module, next.api_access, next.multi_branch_support,
            planId]
    );

    const changes = {};
    for (const field of ['name', ...PLAN_LIMIT_FIELDS, ...PLAN_BOOLEAN_FIELDS]) {
        const before = typeof existing[field] === 'boolean' || typeof existing[field] === 'number' && (existing[field] === 0 || existing[field] === 1) && PLAN_BOOLEAN_FIELDS.includes(field)
            ? !!existing[field] : existing[field];
        const after = next[field];
        if (before !== after) changes[field] = { from: before, to: after };
    }

    try {
        await recordAudit({
            platformAdminId, actorName, actionType: 'PlanUpdated', planId: Number(planId), planName: next.name,
            details: { changes }, ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent, sessionId: requestMeta.sessionId
        });
    } catch (err) { console.error('Failed to write PlanUpdated audit entry:', err); }

    return { success: true };
}

async function archivePlan(planId, platformAdminId, actorName, requestMeta = {}) {
    const existing = await getPlan(planId);
    if (!existing) return { error: 'NOT_FOUND' };
    if (existing.status === 'Archived') return { error: 'ALREADY_ARCHIVED' };

    await db.query("UPDATE subscription_plans SET status = 'Archived' WHERE id = ?", [planId]);
    try {
        await recordAudit({
            platformAdminId, actorName, actionType: 'PlanArchived', planId: Number(planId), planName: existing.name,
            ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent, sessionId: requestMeta.sessionId
        });
    } catch (err) { console.error('Failed to write PlanArchived audit entry:', err); }
    return { success: true };
}

async function restorePlan(planId, platformAdminId, actorName, requestMeta = {}) {
    const existing = await getPlan(planId);
    if (!existing) return { error: 'NOT_FOUND' };
    if (existing.status === 'Active') return { error: 'ALREADY_ACTIVE' };

    await db.query("UPDATE subscription_plans SET status = 'Active' WHERE id = ?", [planId]);
    try {
        await recordAudit({
            platformAdminId, actorName, actionType: 'PlanRestored', planId: Number(planId), planName: existing.name,
            ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent, sessionId: requestMeta.sessionId
        });
    } catch (err) { console.error('Failed to write PlanRestored audit entry:', err); }
    return { success: true };
}

// ==================== Hospital subscriptions ====================

async function listHospitalSubscriptions({ search, status, page, pageSize } = {}) {
    const params = [];
    let where = '1=1';
    if (search) { where += ' AND h.name ILIKE ?'; params.push(`%${search}%`); }
    if (status) { where += ` AND (${EFFECTIVE_STATUS_SQL}) = ?`; params.push(status); }

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM hospitals h WHERE ${where}`, params);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 20));
    const offset = (pageNum - 1) * size;

    const [rows] = await db.query(
        `SELECT h.id AS hospital_id, h.name AS hospital_name, h.plan_id, h.subscription_status,
                h.trial_end_date, h.subscription_end, h.grace_period_end,
                sp.name AS plan_name,
                (${EFFECTIVE_STATUS_SQL}) AS effective_status
         FROM hospitals h
         LEFT JOIN subscription_plans sp ON sp.id = h.plan_id
         WHERE ${where}
         ORDER BY h.name ASC LIMIT ? OFFSET ?`,
        [...params, size, offset]
    );

    return {
        subscriptions: rows.map(r => ({
            ...r,
            trial_end_date: formatDate(r.trial_end_date),
            subscription_end: formatDate(r.subscription_end),
            grace_period_end: formatDate(r.grace_period_end)
        })),
        pagination: { page: pageNum, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)) }
    };
}

function usageLine(current, max) {
    return {
        current, max,
        unlimited: max === null || max === undefined,
        percentUsed: (max !== null && max !== undefined && max > 0) ? Math.min(100, Math.round((current / max) * 100)) : null
    };
}

// Shared by both the platform-side detail page and the hospital-admin's own
// read-only subscription page — the RBAC boundary (which hospital you're
// allowed to call this for) is enforced by the two controllers, not here.
async function getHospitalSubscription(hospitalId) {
    const [rows] = await db.query(
        `SELECT h.id, h.name, h.plan_id, h.trial_start_date, h.trial_end_date,
                h.subscription_start, h.subscription_end, h.grace_period_end, h.subscription_status,
                sp.name AS plan_name, sp.max_branches, sp.max_departments, sp.max_doctors, sp.max_staff,
                sp.max_monthly_appointments, sp.max_monthly_whatsapp_conversations,
                sp.reports_module, sp.reception_module, sp.analytics_module, sp.api_access, sp.multi_branch_support,
                sp.status AS plan_status,
                (${EFFECTIVE_STATUS_SQL}) AS effective_status
         FROM hospitals h LEFT JOIN subscription_plans sp ON sp.id = h.plan_id
         WHERE h.id = ?`,
        [hospitalId]
    );
    const row = rows[0];
    if (!row) return null;

    const [[branchCount]] = await db.query('SELECT COUNT(*) AS cnt FROM branches WHERE hospital_id = ?', [hospitalId]);
    const [[deptCount]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM departments dep JOIN branches b ON b.id = dep.branch_id WHERE b.hospital_id = ?`, [hospitalId]
    );
    const [[doctorCount]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM doctors doc JOIN departments dep ON dep.id = doc.department_id JOIN branches b ON b.id = dep.branch_id WHERE b.hospital_id = ?`,
        [hospitalId]
    );
    const [[staffCount]] = await db.query('SELECT COUNT(*) AS cnt FROM admin_users WHERE hospital_id = ?', [hospitalId]);
    const [[apptCount]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.appointment_date BETWEEN DATE_TRUNC('month', CURRENT_DATE) AND CURRENT_DATE`,
        [hospitalId]
    );

    return {
        hospital: { id: row.id, name: row.name },
        plan: row.plan_id ? {
            id: row.plan_id, name: row.plan_name, status: row.plan_status,
            reportsModule: !!row.reports_module, receptionModule: !!row.reception_module,
            analyticsModule: !!row.analytics_module, apiAccess: !!row.api_access, multiBranchSupport: !!row.multi_branch_support
        } : null,
        subscriptionStatus: row.subscription_status,
        effectiveStatus: row.effective_status,
        trialStartDate: formatDate(row.trial_start_date),
        trialEndDate: formatDate(row.trial_end_date),
        subscriptionStart: formatDate(row.subscription_start),
        subscriptionEnd: formatDate(row.subscription_end),
        gracePeriodEnd: formatDate(row.grace_period_end),
        usage: {
            branches: usageLine(branchCount.cnt, row.max_branches),
            departments: usageLine(deptCount.cnt, row.max_departments),
            doctors: usageLine(doctorCount.cnt, row.max_doctors),
            staff: usageLine(staffCount.cnt, row.max_staff),
            monthlyAppointments: usageLine(apptCount.cnt, row.max_monthly_appointments),
            // No conversation-level data exists anywhere in this app to count
            // from honestly (see the Stage 4C deliverables report's Known
            // Limitations) — reported as explicitly untracked rather than a
            // fabricated 0.
            monthlyWhatsAppConversations: { current: null, max: row.max_monthly_whatsapp_conversations, unlimited: row.max_monthly_whatsapp_conversations == null, percentUsed: null, notTracked: true }
        }
    };
}

async function assignPlan(hospitalId, { planId, isTrial, trialDays, subscriptionMonths }, platformAdminId, actorName, requestMeta = {}) {
    const [[hospital]] = await db.query('SELECT id, name, plan_id FROM hospitals WHERE id = ?', [hospitalId]);
    if (!hospital) return { error: 'NOT_FOUND' };
    if (!planId) return { error: 'PLAN_REQUIRED' };

    const plan = await getPlan(planId);
    if (!plan) return { error: 'PLAN_NOT_FOUND' };
    if (plan.status === 'Archived') return { error: 'PLAN_ARCHIVED' };

    const isFirstAssignment = !hospital.plan_id;

    let setClause, params;
    if (isTrial) {
        const days = Math.max(1, parseInt(trialDays, 10) || 14);
        const [[dates]] = await db.query("SELECT CURRENT_DATE AS start, (CURRENT_DATE + (?::int * INTERVAL '1 day'))::date AS end", [days]);
        setClause = `plan_id=?, trial_start_date=?, trial_end_date=?, subscription_start=NULL, subscription_end=NULL, grace_period_end=NULL, subscription_status='Trial'`;
        params = [planId, dates.start, dates.end];
    } else {
        const months = Math.max(1, parseInt(subscriptionMonths, 10) || 1);
        const [[dates]] = await db.query(
            `SELECT CURRENT_DATE AS start, (CURRENT_DATE + (?::int * INTERVAL '1 month'))::date AS end,
                    (CURRENT_DATE + (?::int * INTERVAL '1 month') + INTERVAL '7 days')::date AS "graceEnd"`,
            [months, months]
        );
        setClause = `plan_id=?, subscription_start=?, subscription_end=?, grace_period_end=?, trial_start_date=NULL, trial_end_date=NULL, subscription_status='Active'`;
        params = [planId, dates.start, dates.end, dates.graceEnd];
    }

    await db.query(`UPDATE hospitals SET ${setClause} WHERE id = ?`, [...params, hospitalId]);

    try {
        await recordAudit({
            platformAdminId, actorName, actionType: isFirstAssignment ? 'PlanAssigned' : 'PlanChanged',
            hospitalId, hospitalName: hospital.name, planId: Number(planId), planName: plan.name,
            details: { isTrial: !!isTrial, previousPlanId: hospital.plan_id },
            ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent, sessionId: requestMeta.sessionId
        });
    } catch (err) { console.error('Failed to write plan-assignment audit entry:', err); }

    return { success: true };
}

async function extendTrial(hospitalId, additionalDays, platformAdminId, actorName, requestMeta = {}) {
    const [[hospital]] = await db.query('SELECT id, name, trial_end_date FROM hospitals WHERE id = ?', [hospitalId]);
    if (!hospital) return { error: 'NOT_FOUND' };

    const days = Math.max(1, parseInt(additionalDays, 10) || 0);
    if (!days) return { error: 'INVALID_DAYS' };

    // Extends from whichever is later — the existing trial_end_date or today
    // — so this works whether the trial is still running or already lapsed
    // (an admin explicitly granting a fresh window). Computed in SQL only.
    const [[dates]] = await db.query(
        "SELECT (GREATEST(COALESCE(?::date, CURRENT_DATE), CURRENT_DATE) + (?::int * INTERVAL '1 day'))::date AS \"newEnd\"",
        [hospital.trial_end_date, days]
    );

    await db.query(`UPDATE hospitals SET trial_end_date = ?, subscription_status = 'Trial' WHERE id = ?`, [dates.newEnd, hospitalId]);

    try {
        await recordAudit({
            platformAdminId, actorName, actionType: 'TrialExtended', hospitalId, hospitalName: hospital.name,
            details: { additionalDays: days, newTrialEndDate: formatDate(dates.newEnd) },
            ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent, sessionId: requestMeta.sessionId
        });
    } catch (err) { console.error('Failed to write TrialExtended audit entry:', err); }

    return { success: true, newTrialEndDate: formatDate(dates.newEnd) };
}

async function setSubscriptionStatus(hospitalId, status, platformAdminId, actorName, requestMeta = {}, { isReactivation = false } = {}) {
    if (!SUBSCRIPTION_BASE_STATUSES.includes(status)) return { error: 'INVALID_STATUS' };

    const [[hospital]] = await db.query('SELECT id, name, subscription_status FROM hospitals WHERE id = ?', [hospitalId]);
    if (!hospital) return { error: 'NOT_FOUND' };
    if (hospital.subscription_status === status) return { error: 'ALREADY_' + status.toUpperCase() };

    await db.query('UPDATE hospitals SET subscription_status = ? WHERE id = ?', [status, hospitalId]);

    const actionType = status === 'Suspended' ? 'SubscriptionSuspended' : (isReactivation ? 'SubscriptionReactivated' : 'SubscriptionActivated');
    try {
        await recordAudit({
            platformAdminId, actorName, actionType, hospitalId, hospitalName: hospital.name,
            ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent, sessionId: requestMeta.sessionId
        });
    } catch (err) { console.error(`Failed to write ${actionType} audit entry:`, err); }

    return { success: true, status };
}

// ==================== Limit enforcement ====================
// The one function every resource-creation guard clause below calls. "No
// plan assigned" or "plan has no cap on this field" both resolve to
// allowed:true — see db/schema.sql's comment on hospitals.plan_id for why
// that's the deliberate, safe default (every pre-Stage-4C hospital has
// plan_id NULL and must keep working exactly as before).
const LIMIT_FIELD_MAP = {
    branches: 'max_branches', departments: 'max_departments', doctors: 'max_doctors',
    staff: 'max_staff', monthlyAppointments: 'max_monthly_appointments'
};
const LIMIT_LABEL_MAP = {
    branches: 'Branches', departments: 'Departments', doctors: 'Doctors',
    staff: 'Staff', monthlyAppointments: 'Monthly Appointments'
};
const LIMIT_COUNT_QUERIES = {
    branches: hospitalId => db.query('SELECT COUNT(*) AS cnt FROM branches WHERE hospital_id = ?', [hospitalId]),
    departments: hospitalId => db.query(
        `SELECT COUNT(*) AS cnt FROM departments dep JOIN branches b ON b.id = dep.branch_id WHERE b.hospital_id = ?`, [hospitalId]
    ),
    doctors: hospitalId => db.query(
        `SELECT COUNT(*) AS cnt FROM doctors doc JOIN departments dep ON dep.id = doc.department_id JOIN branches b ON b.id = dep.branch_id WHERE b.hospital_id = ?`,
        [hospitalId]
    ),
    staff: hospitalId => db.query('SELECT COUNT(*) AS cnt FROM admin_users WHERE hospital_id = ?', [hospitalId]),
    monthlyAppointments: hospitalId => db.query(
        `SELECT COUNT(*) AS cnt FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE p.hospital_id = ? AND a.appointment_date BETWEEN DATE_TRUNC('month', CURRENT_DATE) AND CURRENT_DATE`,
        [hospitalId]
    )
};

async function checkLimit(hospitalId, limitType) {
    const field = LIMIT_FIELD_MAP[limitType];
    if (!field) throw new Error(`Unknown subscription limit type: ${limitType}`);

    const [[row]] = await db.query(
        `SELECT h.plan_id, sp.${field} AS max_value FROM hospitals h LEFT JOIN subscription_plans sp ON sp.id = h.plan_id WHERE h.id = ?`,
        [hospitalId]
    );
    if (!row || !row.plan_id || row.max_value === null || row.max_value === undefined) {
        return { allowed: true };
    }

    const [[{ cnt }]] = await LIMIT_COUNT_QUERIES[limitType](hospitalId);
    if (cnt >= row.max_value) {
        const label = LIMIT_LABEL_MAP[limitType];
        return {
            allowed: false, error: 'PLAN_LIMIT_REACHED', limitType, current: cnt, max: row.max_value,
            message: `Maximum ${label} reached for your current plan (${cnt}/${row.max_value}). Please contact your platform administrator to upgrade your plan.`
        };
    }
    return { allowed: true, current: cnt, max: row.max_value };
}

module.exports = {
    // Plans
    listPlans, getPlan, createPlan, updatePlan, archivePlan, restorePlan,
    // Hospital subscriptions
    listHospitalSubscriptions, getHospitalSubscription, assignPlan, extendTrial, setSubscriptionStatus,
    // Enforcement
    checkLimit,
    // Audit
    listSubscriptionAuditLog
};
