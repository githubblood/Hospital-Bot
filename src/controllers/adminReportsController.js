const adminReportService = require('../services/adminReportService');
const pdfReportBuilder = require('../services/pdfReportBuilder');

exports.getTodayReport = async (req, res) => {
    const data = await adminReportService.getTodayReportData(req.admin.hospital_id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${data.todayStr}.pdf"`);
    pdfReportBuilder.buildTodayReportPdf(data, res);
};
