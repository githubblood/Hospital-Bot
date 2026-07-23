// Hand-rolled — no CSV library exists anywhere in this codebase yet
// (topbar.js's "Generate Report" button is PDF-only despite its stale
// comment). RFC 4180 quoting: wrap in quotes and double any embedded quote
// whenever a field contains a comma, quote, or newline.
function escapeCsvField(value) {
    const str = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
}

function buildCsv(columns, rows) {
    const header = columns.map(c => escapeCsvField(c.label)).join(',');
    const lines = rows.map(row => columns.map(c => escapeCsvField(row[c.key])).join(','));
    return [header, ...lines].join('\r\n');
}

module.exports = { buildCsv };
