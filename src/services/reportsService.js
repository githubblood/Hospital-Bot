const db = require('../config/db');
const scheduleService = require('./scheduleService');
const { cleanDoctorName } = require('../rule_engine/messages');

// Every named period resolves to a pair of CURDATE()-relative SQL
// expressions, never JS Date arithmetic — same reasoning as
// adminReportService.getTodayReportData: a JS Date -> ISO conversion has
// repeatedly shifted dates by a day in IST on this project. Resolving through
// one SELECT gives back canonical 'YYYY-MM-DD' strings that are then used as
// plain bind params everywhere else (BETWEEN ? AND ?), so no query ever
// re-derives "today" in JS.
const PERIOD_EXPR = {
    today: { from: 'CURRENT_DATE', to: 'CURRENT_DATE' },
    yesterday: { from: "CURRENT_DATE - INTERVAL '1 day'", to: "CURRENT_DATE - INTERVAL '1 day'" },
    last7: { from: "CURRENT_DATE - INTERVAL '6 days'", to: 'CURRENT_DATE' },
    last30: { from: "CURRENT_DATE - INTERVAL '29 days'", to: 'CURRENT_DATE' },
    thisMonth: { from: "DATE_TRUNC('month', CURRENT_DATE)", to: 'CURRENT_DATE' },
    lastMonth: {
        from: "DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')",
        to: "(DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day')"
    }
};

async function resolveDateRange(period, customFrom, customTo) {
    if (period === 'custom') {
        if (!customFrom || !customTo) return { error: 'DATE_RANGE_REQUIRED' };
        const [[row]] = await db.query(
            `SELECT TO_CHAR(?::date, 'YYYY-MM-DD') AS from_date, TO_CHAR(?::date, 'YYYY-MM-DD') AS to_date`,
            [customFrom, customTo]
        );
        if (!row.from_date || !row.to_date) return { error: 'INVALID_RANGE' };
        if (row.from_date > row.to_date) return { error: 'INVALID_RANGE' };
        return { from: row.from_date, to: row.to_date };
    }

    const expr = PERIOD_EXPR[period] || PERIOD_EXPR.last30;
    const [[row]] = await db.query(
        `SELECT TO_CHAR((${expr.from})::date, 'YYYY-MM-DD') AS from_date, TO_CHAR((${expr.to})::date, 'YYYY-MM-DD') AS to_date`
    );
    return { from: row.from_date, to: row.to_date };
}

// Shared join chain + WHERE builder every report below uses to scope by
// hospital and apply the optional branch/department/doctor filters — the
// same doctors->departments->branches chain adminStatsService/doctorAdminService
// already use for hospital scoping (doctors carry no hospital_id directly).
function buildScopeClause(hospitalId, range, filters) {
    const where = ['p.hospital_id = ?', 'a.appointment_date BETWEEN ? AND ?'];
    const params = [hospitalId, range.from, range.to];
    if (filters.branchId) { where.push('b.id = ?'); params.push(filters.branchId); }
    if (filters.departmentId) { where.push('dep.id = ?'); params.push(filters.departmentId); }
    if (filters.doctorId) { where.push('doc.id = ?'); params.push(filters.doctorId); }
    return { whereSql: where.join(' AND '), params };
}

const JOIN_CHAIN = `
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN doctors doc ON doc.id = a.doctor_id
    JOIN departments dep ON dep.id = doc.department_id
    JOIN branches b ON b.id = dep.branch_id
`;

function daysBetween(fromStr, toStr) {
    const from = new Date(`${fromStr}T00:00:00`);
    const to = new Date(`${toStr}T00:00:00`);
    return Math.max(1, Math.round((to - from) / 86400000) + 1);
}

// ==================== 1. Appointment Reports ====================

async function getAppointmentReport(hospitalId, filters) {
    const range = await resolveDateRange(filters.period, filters.from, filters.to);
    if (range.error) return { error: range.error };
    const { whereSql, params } = buildScopeClause(hospitalId, range, filters);

    const [[kpis]] = await db.query(
        `SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE a.status = 'Confirmed') AS confirmed,
            COUNT(*) FILTER (WHERE a.status IN ('Pending', 'Pending_Payment')) AS pending,
            COUNT(*) FILTER (WHERE a.status = 'Cancelled') AS cancelled,
            COUNT(*) FILTER (WHERE a.status = 'Completed') AS completed,
            COUNT(*) FILTER (WHERE a.status = 'No Show') AS no_show,
            COUNT(*) FILTER (WHERE a.status = 'Waitlisted') AS waitlisted,
            COUNT(*) FILTER (WHERE a.status = 'Rescheduled') AS rescheduled,
            COUNT(*) FILTER (WHERE a.booking_source = 'Walk-in') AS walk_in,
            COUNT(*) FILTER (WHERE a.booking_source = 'WhatsApp') AS whatsapp,
            COUNT(*) FILTER (WHERE a.booking_source = 'Reception') AS manual
         ${JOIN_CHAIN} WHERE ${whereSql}`,
        params
    );

    const groupBy = ['day', 'week', 'month'].includes(filters.groupBy) ? filters.groupBy : 'day';
    const dateExpr = groupBy === 'day'
        ? "TO_CHAR(a.appointment_date, 'YYYY-MM-DD')"
        : groupBy === 'week'
            ? `TO_CHAR(a.appointment_date, 'IYYY-"W"IW')`
            : "TO_CHAR(a.appointment_date, 'YYYY-MM')";

    const [trend] = await db.query(
        `SELECT ${dateExpr} AS bucket,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE a.status = 'Confirmed') AS confirmed,
                COUNT(*) FILTER (WHERE a.status = 'Cancelled') AS cancelled,
                COUNT(*) FILTER (WHERE a.status = 'Completed') AS completed,
                COUNT(*) FILTER (WHERE a.status = 'No Show') AS no_show
         ${JOIN_CHAIN} WHERE ${whereSql}
         GROUP BY bucket ORDER BY bucket`,
        params
    );

    return {
        period: range,
        kpis: {
            total: kpis.total,
            confirmed: Number(kpis.confirmed) || 0,
            pending: Number(kpis.pending) || 0,
            cancelled: Number(kpis.cancelled) || 0,
            completed: Number(kpis.completed) || 0,
            noShow: Number(kpis.no_show) || 0,
            waitlisted: Number(kpis.waitlisted) || 0,
            rescheduled: Number(kpis.rescheduled) || 0,
            walkIn: Number(kpis.walk_in) || 0,
            whatsapp: Number(kpis.whatsapp) || 0,
            manual: Number(kpis.manual) || 0
        },
        groupBy,
        trend: trend.map(r => ({
            bucket: r.bucket, total: r.total,
            confirmed: Number(r.confirmed) || 0, cancelled: Number(r.cancelled) || 0,
            completed: Number(r.completed) || 0, noShow: Number(r.no_show) || 0
        }))
    };
}

// ==================== 2. Doctor Performance ====================

// Theoretical booking capacity for a doctor over [fromStr, toStr]: sums
// max_tokens across every configured shift on every calendar day that falls
// on one of the doctor's working_days — the same schedule_json shape and
// getWeekdayKey(new Date(...)) local-date pattern scheduleService.js itself
// uses (not a comparison against a MySQL-returned Date, so this local Date
// iteration is the established-safe case, not the risky one).
function computeCapacity(scheduleJson, fromStr, toStr) {
    const schedule = scheduleService.getScheduleForDoctor(scheduleJson);
    const perDayCapacity = Object.values(schedule.shifts).reduce((sum, s) => sum + (Number(s.max_tokens) || 0), 0);
    if (perDayCapacity === 0 || schedule.working_days.length === 0) return 0;

    let capacity = 0;
    const cursor = new Date(`${fromStr}T00:00:00`);
    const end = new Date(`${toStr}T00:00:00`);
    const MAX_ITER_DAYS = 400;
    for (let i = 0; cursor <= end && i < MAX_ITER_DAYS; i++, cursor.setDate(cursor.getDate() + 1)) {
        if (schedule.working_days.includes(scheduleService.getWeekdayKey(cursor))) {
            capacity += perDayCapacity;
        }
    }
    return capacity;
}

async function getDoctorPerformanceReport(hospitalId, filters) {
    const range = await resolveDateRange(filters.period, filters.from, filters.to);
    if (range.error) return { error: range.error };
    const { whereSql, params } = buildScopeClause(hospitalId, range, filters);
    const rangeDays = daysBetween(range.from, range.to);

    const [rows] = await db.query(
        `SELECT doc.id AS doctor_id, doc.name AS doctor_name, doc.schedule_json,
                dep.name_en AS department_name, b.name AS branch_name,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE a.status = 'Completed') AS completed,
                COUNT(*) FILTER (WHERE a.status = 'Cancelled') AS cancelled,
                COUNT(*) FILTER (WHERE a.status = 'No Show') AS no_show
         ${JOIN_CHAIN} WHERE ${whereSql}
         GROUP BY doc.id, dep.name_en, b.name ORDER BY total DESC`,
        params
    );

    const report = rows.map(r => {
        const booked = r.total - Number(r.cancelled);
        const capacity = computeCapacity(r.schedule_json, range.from, range.to);
        return {
            doctorId: r.doctor_id,
            doctorName: cleanDoctorName(r.doctor_name),
            departmentName: r.department_name,
            branchName: r.branch_name,
            total: r.total,
            completed: Number(r.completed) || 0,
            cancelled: Number(r.cancelled) || 0,
            noShow: Number(r.no_show) || 0,
            utilizationPct: capacity > 0 ? Math.round((booked / capacity) * 1000) / 10 : null,
            avgDailyLoad: Math.round((r.total / rangeDays) * 10) / 10
        };
    });

    return { period: range, rows: report };
}

// ==================== 3. Department Analytics ====================

async function getDepartmentAnalytics(hospitalId, filters) {
    const range = await resolveDateRange(filters.period, filters.from, filters.to);
    if (range.error) return { error: range.error };
    const { whereSql, params } = buildScopeClause(hospitalId, range, filters);

    const [rows] = await db.query(
        `SELECT dep.id AS department_id, dep.name_en AS department_name, b.name AS branch_name,
                COUNT(*) AS total,
                COUNT(DISTINCT a.patient_id) AS patient_volume,
                COUNT(DISTINCT doc.id) AS doctor_count
         ${JOIN_CHAIN} WHERE ${whereSql}
         GROUP BY dep.id, b.name ORDER BY total DESC`,
        params
    );

    const report = rows.map(r => ({
        departmentId: r.department_id,
        departmentName: r.department_name,
        branchName: r.branch_name,
        total: r.total,
        patientVolume: r.patient_volume,
        doctorCount: r.doctor_count
    }));

    return {
        period: range,
        rows: report,
        mostBooked: report.length ? report[0].departmentName : null,
        leastBooked: report.length ? report[report.length - 1].departmentName : null
    };
}

// ==================== 4. Branch Analytics ====================

async function getBranchAnalytics(hospitalId, filters) {
    const range = await resolveDateRange(filters.period, filters.from, filters.to);
    if (range.error) return { error: range.error };
    const { whereSql, params } = buildScopeClause(hospitalId, range, filters);

    const [rows] = await db.query(
        `SELECT b.id AS branch_id, b.name AS branch_name,
                COUNT(*) AS appointment_count,
                COUNT(DISTINCT dep.id) AS department_count,
                COUNT(DISTINCT doc.id) AS doctor_count,
                COUNT(DISTINCT a.patient_id) AS patient_count
         ${JOIN_CHAIN} WHERE ${whereSql}
         GROUP BY b.id ORDER BY appointment_count DESC`,
        params
    );

    return {
        period: range,
        rows: rows.map(r => ({
            branchId: r.branch_id, branchName: r.branch_name,
            appointmentCount: r.appointment_count, departmentCount: r.department_count,
            doctorCount: r.doctor_count, patientCount: r.patient_count
        }))
    };
}

// ==================== 5. Reception Analytics ====================

async function getReceptionAnalytics(hospitalId, filters) {
    const range = await resolveDateRange(filters.period, filters.from, filters.to);
    if (range.error) return { error: range.error };
    const { whereSql, params } = buildScopeClause(hospitalId, range, filters);

    const [[row]] = await db.query(
        `SELECT
            COUNT(*) FILTER (WHERE a.booking_source = 'Walk-in') AS walk_ins,
            COUNT(*) FILTER (WHERE a.booking_source = 'Reception') AS manual_bookings,
            COUNT(*) FILTER (WHERE a.checked_in_at IS NOT NULL) AS check_ins,
            AVG(CASE WHEN a.checked_in_at IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (a.checked_in_at - a.created_at)) / 60 END) AS avg_wait_minutes,
            AVG(CASE WHEN a.checked_in_at IS NOT NULL AND a.completed_at IS NOT NULL AND a.completed_at > a.checked_in_at
                     THEN EXTRACT(EPOCH FROM (a.completed_at - a.checked_in_at)) / 60 END) AS avg_consultation_minutes
         ${JOIN_CHAIN} WHERE ${whereSql}`,
        params
    );

    return {
        period: range,
        kpis: {
            walkIns: Number(row.walk_ins) || 0,
            manualBookings: Number(row.manual_bookings) || 0,
            checkIns: Number(row.check_ins) || 0,
            avgWaitingMinutes: row.avg_wait_minutes !== null ? Math.round(row.avg_wait_minutes * 10) / 10 : null,
            avgConsultationMinutes: row.avg_consultation_minutes !== null ? Math.round(row.avg_consultation_minutes * 10) / 10 : null
        }
    };
}

// ==================== 6. Patient Analytics ====================

async function getPatientAnalytics(hospitalId, filters) {
    const range = await resolveDateRange(filters.period, filters.from, filters.to);
    if (range.error) return { error: range.error };

    const [[newRow]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM patients WHERE hospital_id = ? AND DATE(created_at) BETWEEN ? AND ?`,
        [hospitalId, range.from, range.to]
    );

    // A patient in this period counts as "returning" if they already had at
    // least one appointment strictly before the period started.
    const [[returningRow]] = await db.query(
        `SELECT COUNT(DISTINCT a.patient_id) AS cnt
         ${JOIN_CHAIN}
         WHERE p.hospital_id = ? AND a.appointment_date BETWEEN ? AND ?
           AND EXISTS (
               SELECT 1 FROM appointments a2
               WHERE a2.patient_id = a.patient_id AND a2.appointment_date < ?
           )`,
        [hospitalId, range.from, range.to, range.from]
    );

    // Lifetime metric (not period-filtered) — "does this hospital's patient
    // base tend to come back", independent of which window is selected.
    const [[repeatRow]] = await db.query(
        `SELECT COUNT(*) AS total_with_visit, COUNT(*) FILTER (WHERE appt_count > 1) AS repeat_count
         FROM (
             SELECT a.patient_id, COUNT(*) AS appt_count
             FROM appointments a JOIN patients p ON p.id = a.patient_id
             WHERE p.hospital_id = ?
             GROUP BY a.patient_id
         ) sub`,
        [hospitalId]
    );

    const { whereSql, params } = buildScopeClause(hospitalId, range, filters);
    const [genderRows] = await db.query(
        `SELECT p.gender, COUNT(DISTINCT a.patient_id) AS cnt
         ${JOIN_CHAIN} WHERE ${whereSql}
         GROUP BY p.gender`,
        params
    );
    const [ageRows] = await db.query(
        `SELECT
            CASE
                WHEN p.age <= 18 THEN '0-18'
                WHEN p.age <= 35 THEN '19-35'
                WHEN p.age <= 50 THEN '36-50'
                WHEN p.age <= 65 THEN '51-65'
                ELSE '65+'
            END AS age_group,
            COUNT(DISTINCT a.patient_id) AS cnt
         ${JOIN_CHAIN} WHERE ${whereSql}
         GROUP BY age_group`,
        params
    );
    const AGE_ORDER = ['0-18', '19-35', '36-50', '51-65', '65+'];

    const totalWithVisit = Number(repeatRow.total_with_visit) || 0;
    const repeatCount = Number(repeatRow.repeat_count) || 0;

    return {
        period: range,
        kpis: {
            newPatients: newRow.cnt,
            returningPatients: returningRow.cnt,
            repeatVisitPercentage: totalWithVisit > 0 ? Math.round((repeatCount / totalWithVisit) * 1000) / 10 : 0
        },
        genderDistribution: genderRows.map(r => ({ gender: r.gender, count: r.cnt })),
        ageGroups: AGE_ORDER
            .map(group => ({ group, count: ageRows.find(r => r.age_group === group)?.cnt || 0 }))
            .filter(r => r.count > 0 || ageRows.length > 0)
    };
}

// ==================== Export (flattened rows for CSV/XLSX) ====================

const EXPORT_TYPES = ['appointments', 'doctors', 'departments', 'branches', 'reception', 'patients'];

async function getExportData(hospitalId, type, filters) {
    if (!EXPORT_TYPES.includes(type)) return { error: 'INVALID_REPORT_TYPE' };

    if (type === 'appointments') {
        const data = await getAppointmentReport(hospitalId, filters);
        if (data.error) return data;
        return {
            period: data.period,
            sheetName: 'Appointments',
            columns: [
                { key: 'bucket', label: 'Period' }, { key: 'total', label: 'Total' },
                { key: 'confirmed', label: 'Confirmed' }, { key: 'cancelled', label: 'Cancelled' },
                { key: 'completed', label: 'Completed' }, { key: 'noShow', label: 'No Show' }
            ],
            rows: data.trend
        };
    }
    if (type === 'doctors') {
        const data = await getDoctorPerformanceReport(hospitalId, filters);
        if (data.error) return data;
        return {
            period: data.period,
            sheetName: 'Doctor Performance',
            columns: [
                { key: 'doctorName', label: 'Doctor' }, { key: 'departmentName', label: 'Department' },
                { key: 'branchName', label: 'Branch' }, { key: 'total', label: 'Total' },
                { key: 'completed', label: 'Completed' }, { key: 'cancelled', label: 'Cancelled' },
                { key: 'noShow', label: 'No Show' }, { key: 'utilizationPct', label: 'Utilization %' },
                { key: 'avgDailyLoad', label: 'Avg Daily Load' }
            ],
            rows: data.rows
        };
    }
    if (type === 'departments') {
        const data = await getDepartmentAnalytics(hospitalId, filters);
        if (data.error) return data;
        return {
            period: data.period,
            sheetName: 'Department Analytics',
            columns: [
                { key: 'departmentName', label: 'Department' }, { key: 'branchName', label: 'Branch' },
                { key: 'total', label: 'Total Appointments' }, { key: 'patientVolume', label: 'Patient Volume' },
                { key: 'doctorCount', label: 'Doctor Count' }
            ],
            rows: data.rows
        };
    }
    if (type === 'branches') {
        const data = await getBranchAnalytics(hospitalId, filters);
        if (data.error) return data;
        return {
            period: data.period,
            sheetName: 'Branch Analytics',
            columns: [
                { key: 'branchName', label: 'Branch' }, { key: 'appointmentCount', label: 'Appointments' },
                { key: 'departmentCount', label: 'Departments' }, { key: 'doctorCount', label: 'Doctors' },
                { key: 'patientCount', label: 'Patients' }
            ],
            rows: data.rows
        };
    }
    if (type === 'reception') {
        const data = await getReceptionAnalytics(hospitalId, filters);
        if (data.error) return data;
        return {
            period: data.period,
            sheetName: 'Reception Analytics',
            columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }],
            rows: [
                { metric: 'Walk-ins', value: data.kpis.walkIns },
                { metric: 'Manual Bookings', value: data.kpis.manualBookings },
                { metric: 'Check-ins', value: data.kpis.checkIns },
                { metric: 'Avg Waiting Time (min)', value: data.kpis.avgWaitingMinutes ?? 'N/A' },
                { metric: 'Avg Consultation Flow (min)', value: data.kpis.avgConsultationMinutes ?? 'N/A' }
            ]
        };
    }
    // patients
    const data = await getPatientAnalytics(hospitalId, filters);
    if (data.error) return data;
    return {
        period: data.period,
        sheetName: 'Patient Analytics',
        columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }],
        rows: [
            { metric: 'New Patients', value: data.kpis.newPatients },
            { metric: 'Returning Patients', value: data.kpis.returningPatients },
            { metric: 'Repeat Visit % (all-time)', value: data.kpis.repeatVisitPercentage },
            ...data.genderDistribution.map(g => ({ metric: `Gender: ${g.gender}`, value: g.count })),
            ...data.ageGroups.map(a => ({ metric: `Age Group: ${a.group}`, value: a.count }))
        ]
    };
}

module.exports = {
    resolveDateRange,
    getAppointmentReport,
    getDoctorPerformanceReport,
    getDepartmentAnalytics,
    getBranchAnalytics,
    getReceptionAnalytics,
    getPatientAnalytics,
    getExportData
};
