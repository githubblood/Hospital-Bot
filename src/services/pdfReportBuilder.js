const PDFDocument = require('pdfkit');

const MARGIN = 40;
const PRIMARY = '#1E9E7A';
const TEXT = '#1a2b3c';
const MUTED = '#6b7a90';
const BORDER = '#e2e8f0';
const HEADER_BG = '#E4F5EF';

// Fixed column layout for the appointments table, sized to fit A4's usable
// width (595.28 - 2*MARGIN = 515.28pt) exactly.
const COLUMNS = [
    { key: 'patient', label: 'Patient', width: 100 },
    { key: 'phone', label: 'Phone', width: 80 },
    { key: 'doctor', label: 'Doctor', width: 100 },
    { key: 'shift', label: 'Shift', width: 50 },
    { key: 'token', label: 'Token', width: 35 },
    { key: 'status', label: 'Status', width: 75 },
    { key: 'payment', label: 'Payment', width: 75 }
];

function drawTableHeader(doc, x) {
    const rowHeight = 20;
    doc.rect(x, doc.y, COLUMNS.reduce((s, c) => s + c.width, 0), rowHeight).fill(HEADER_BG);
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9);
    let colX = x;
    const y = doc.y + 6;
    COLUMNS.forEach(col => {
        doc.text(col.label, colX + 6, y, { width: col.width - 8, ellipsis: true });
        colX += col.width;
    });
    doc.y += rowHeight;
}

function ensureSpace(doc, x, neededHeight) {
    const bottom = doc.page.height - doc.page.margins.bottom;
    if (doc.y + neededHeight > bottom) {
        doc.addPage();
        drawTableHeader(doc, x);
    }
}

function drawTableRow(doc, x, row, zebra) {
    const rowHeight = 20;
    ensureSpace(doc, x, rowHeight);
    const totalWidth = COLUMNS.reduce((s, c) => s + c.width, 0);
    if (zebra) doc.rect(x, doc.y, totalWidth, rowHeight).fill('#FAFBFC');
    doc.fillColor(TEXT).font('Helvetica').fontSize(8.5);
    let colX = x;
    const y = doc.y + 6;
    COLUMNS.forEach(col => {
        doc.text(String(row[col.key] ?? ''), colX + 6, y, { width: col.width - 8, ellipsis: true });
        colX += col.width;
    });
    doc.y += rowHeight;
}

// Streams a today's-summary PDF directly to `res` (which must already have
// its response headers set by the caller). Not a decorative export — real
// hospital name, real CURDATE()-derived date, real stats/billing/appointment
// data, same as the CSV export this replaced.
function buildTodayReportPdf({ hospitalName, todayStr, stats, billing, appointments }, res) {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
    doc.pipe(res);

    doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(20).text(hospitalName);
    doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(`Daily Report — ${todayStr}`);
    doc.moveDown(0.8);
    doc.strokeColor(BORDER).moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
    doc.moveDown(1);

    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(13).text('Summary');
    doc.moveDown(0.4);

    const summaryRows = [
        ["Today's Appointments", stats.todayAppointments],
        ['Pending Approvals', stats.pendingApprovals],
        ['Active Doctors', stats.activeDoctors],
        ['Total Patients', stats.totalPatients],
        ["Today's Billing Collection", `Rs. ${billing.today_collection}`],
        ['Unpaid Bills', billing.unpaid_count],
        ['Bills Generated Today', billing.today_total],
        ['This Month Collection', `Rs. ${billing.month_collection}`]
    ];

    doc.font('Helvetica').fontSize(10.5);
    summaryRows.forEach(([label, value]) => {
        doc.fillColor(MUTED).text(label, MARGIN, doc.y, { continued: true, width: 260 });
        doc.fillColor(TEXT).font('Helvetica-Bold').text(`  ${value}`);
        doc.font('Helvetica');
    });

    doc.moveDown(1.2);
    doc.strokeColor(BORDER).moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
    doc.moveDown(1);

    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(13).text("Today's Appointments");
    doc.moveDown(0.5);

    if (appointments.length === 0) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(10.5).text('No appointments today.');
    } else {
        drawTableHeader(doc, MARGIN);
        appointments.forEach((a, i) => {
            drawTableRow(doc, MARGIN, {
                patient: a.patient_name,
                phone: a.phone_number,
                doctor: `Dr. ${a.doctor_name}`,
                shift: a.shift,
                token: a.token_number,
                status: a.status,
                payment: a.payment_status
            }, i % 2 === 1);
        });
    }

    doc.end();
}

module.exports = { buildTodayReportPdf };
