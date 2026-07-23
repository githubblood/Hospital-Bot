const ExcelJS = require('exceljs');

// Excel sheet names are capped at 31 chars and can't contain []:*?/\\.
function sanitizeSheetName(name) {
    return String(name).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31);
}

async function buildXlsx(sheetName, columns, rows) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sanitizeSheetName(sheetName));
    sheet.columns = columns.map(c => ({ header: c.label, key: c.key, width: Math.max(14, c.label.length + 2) }));
    sheet.getRow(1).font = { bold: true };
    rows.forEach(row => sheet.addRow(row));
    return workbook.xlsx.writeBuffer();
}

module.exports = { buildXlsx };
