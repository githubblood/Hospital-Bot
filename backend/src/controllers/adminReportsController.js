const adminReportService = require('../services/adminReportService');
const pdfReportBuilder = require('../services/pdfReportBuilder');
const reportsService = require('../services/reportsService');
const csvReportBuilder = require('../services/csvReportBuilder');
const xlsxReportBuilder = require('../services/xlsxReportBuilder');
const catalogService = require('../services/catalogService');

exports.getTodayReport = async (req, res) => {
    const data = await adminReportService.getTodayReportData(req.admin.hospital_id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${data.todayStr}.pdf"`);
    pdfReportBuilder.buildTodayReportPdf(data, res);
};

// ==================== Stage 3 — Reports & Analytics ====================
// Read-only throughout: every handler below only ever calls reportsService's
// SELECT-only query functions, never a write path. Filters are parsed here
// once and threaded into every report/export call the same way.

function parseFilters(req) {
    const { period = 'last30', from, to, branchId, departmentId, doctorId, groupBy } = req.query;
    return {
        period, from, to, groupBy,
        branchId: branchId ? Number(branchId) : null,
        departmentId: departmentId ? Number(departmentId) : null,
        doctorId: doctorId ? Number(doctorId) : null
    };
}

function respond(res, result) {
    if (result.error === 'DATE_RANGE_REQUIRED') {
        return res.status(400).json({ error: 'A custom range requires both from and to dates.' });
    }
    if (result.error === 'INVALID_RANGE') {
        return res.status(400).json({ error: 'The "from" date must not be after the "to" date.' });
    }
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true, ...result });
}

exports.getAppointmentReport = async (req, res) => {
    respond(res, await reportsService.getAppointmentReport(req.admin.hospital_id, parseFilters(req)));
};

exports.getDoctorReport = async (req, res) => {
    respond(res, await reportsService.getDoctorPerformanceReport(req.admin.hospital_id, parseFilters(req)));
};

exports.getDepartmentReport = async (req, res) => {
    respond(res, await reportsService.getDepartmentAnalytics(req.admin.hospital_id, parseFilters(req)));
};

exports.getBranchReport = async (req, res) => {
    respond(res, await reportsService.getBranchAnalytics(req.admin.hospital_id, parseFilters(req)));
};

exports.getReceptionReport = async (req, res) => {
    respond(res, await reportsService.getReceptionAnalytics(req.admin.hospital_id, parseFilters(req)));
};

exports.getPatientReport = async (req, res) => {
    respond(res, await reportsService.getPatientAnalytics(req.admin.hospital_id, parseFilters(req)));
};

// Branch/department/doctor lists to populate the Reports page's filter
// dropdowns — reuses catalogService rather than duplicating an ownership-
// scoped listing query.
exports.getFilterOptions = async (req, res) => {
    const hospitalId = req.admin.hospital_id;
    const [branches, departments, doctors] = await Promise.all([
        catalogService.getActiveBranches(hospitalId),
        catalogService.getAllDepartmentsForHospital(hospitalId),
        catalogService.getAllDoctorsForHospital(hospitalId)
    ]);
    res.json({
        branches: branches.map(b => ({ id: b.id, name: b.name })),
        departments: departments.map(d => ({ id: d.id, name: d.name_en, branchId: d.branch_id })),
        doctors: doctors.map(d => ({ id: d.id, name: d.name, departmentId: d.department_id }))
    });
};

exports.exportReport = async (req, res) => {
    const { type, format = 'csv' } = req.query;
    const filters = parseFilters(req);
    const data = await reportsService.getExportData(req.admin.hospital_id, type, filters);
    if (data.error === 'INVALID_REPORT_TYPE') return res.status(400).json({ error: 'Unknown report type.' });
    if (data.error) return respond(res, data);

    const filenameBase = `${type}-report-${data.period.from}_to_${data.period.to}`;

    if (format === 'xlsx') {
        const buffer = await xlsxReportBuilder.buildXlsx(data.sheetName, data.columns, data.rows);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
        return res.send(Buffer.from(buffer));
    }

    const csv = csvReportBuilder.buildCsv(data.columns, data.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
    res.send(csv);
};
