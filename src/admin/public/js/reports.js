// Auth guard, sidebar user block, logout, search, and activity are all
// wired centrally by topbar.js (loaded before this file).

const admin = AdminAuth.getAdmin();
const RANK = { Receptionist: 1, 'Hospital Administrator': 2, 'Super Admin': 3 };
const canViewReports = admin && (RANK[admin.role] || 0) >= RANK['Hospital Administrator'];

if (!canViewReports) {
    document.querySelector('.report-filters').style.display = 'none';
    document.querySelector('.report-tabs').style.display = 'none';
    document.getElementById('reportLoading').style.display = 'none';
    document.querySelectorAll('.report-panel').forEach(p => p.classList.remove('active'));
    const banner = document.getElementById('reportErrorBanner');
    banner.textContent = 'Reports & Analytics is available to Hospital Administrators only.';
    banner.classList.add('show');
}

let activeTab = 'appointments';
let currentGroupBy = 'day';
let filterOptions = { branches: [], departments: [], doctors: [] };

function statusBadgeColorIndex(i) { return ChartKit.palette()[i % ChartKit.palette().length]; }

function buildFilterQuery(extra = {}) {
    const params = new URLSearchParams();
    const period = document.getElementById('filterPeriod').value;
    params.set('period', period);
    if (period === 'custom') {
        params.set('from', document.getElementById('filterFrom').value);
        params.set('to', document.getElementById('filterTo').value);
    }
    const branchId = document.getElementById('filterBranch').value;
    const departmentId = document.getElementById('filterDepartment').value;
    const doctorId = document.getElementById('filterDoctor').value;
    if (branchId) params.set('branchId', branchId);
    if (departmentId) params.set('departmentId', departmentId);
    if (doctorId) params.set('doctorId', doctorId);
    Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    return params.toString();
}

function showLoading(isLoading) {
    document.getElementById('reportLoading').style.display = isLoading ? 'block' : 'none';
}

function showError(message) {
    const banner = document.getElementById('reportErrorBanner');
    if (!message) { banner.classList.remove('show'); banner.textContent = ''; return; }
    banner.textContent = message;
    banner.classList.add('show');
}

function fmtNum(v) { return v === null || v === undefined ? 'N/A' : v; }

function kpiCard(label, value) {
    return `<div class="report-kpi-card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(String(value))}</div></div>`;
}

// ---- Per-tab endpoint map ----
const TAB_ENDPOINT = {
    appointments: '/reports/analytics/appointments',
    doctors: '/reports/analytics/doctors',
    departments: '/reports/analytics/departments',
    branches: '/reports/analytics/branches',
    reception: '/reports/analytics/reception',
    patients: '/reports/analytics/patients'
};

async function loadTab(tab) {
    if (!canViewReports) return;
    showLoading(true);
    showError(null);
    try {
        const extra = tab === 'appointments' ? { groupBy: currentGroupBy } : {};
        const res = await AdminAuth.authFetch(`/api/admin${TAB_ENDPOINT[tab]}?${buildFilterQuery(extra)}`);
        const data = await res.json();
        if (!res.ok) { showError(data.error || 'Could not load this report.'); return; }

        if (tab === 'appointments') renderAppointments(data);
        else if (tab === 'doctors') renderDoctors(data);
        else if (tab === 'departments') renderDepartments(data);
        else if (tab === 'branches') renderBranches(data);
        else if (tab === 'reception') renderReception(data);
        else if (tab === 'patients') renderPatients(data);
    } catch (err) {
        console.error(`Failed to load ${tab} report:`, err);
        showError('Something went wrong loading this report. Please try again.');
    } finally {
        showLoading(false);
    }
}

// ---- 1. Appointments ----
function renderAppointments(data) {
    const k = data.kpis;
    document.getElementById('apptKpiGrid').innerHTML = [
        kpiCard('Total', k.total), kpiCard('Confirmed', k.confirmed), kpiCard('Pending', k.pending),
        kpiCard('Cancelled', k.cancelled), kpiCard('Completed', k.completed), kpiCard('No Show', k.noShow),
        kpiCard('Waitlisted', k.waitlisted), kpiCard('Walk-in', k.walkIn), kpiCard('WhatsApp', k.whatsapp),
        kpiCard('Manual', k.manual)
    ].join('');

    ChartKit.renderLineChart(document.getElementById('chartApptTrend'), data.trend, {
        xKey: 'bucket', yKey: 'total', formatValue: (v) => `${v} appt${v === 1 ? '' : 's'}`,
        formatLabel: (v) => String(v).slice(5)
    });

    const tbody = document.getElementById('apptTrendTableBody');
    const empty = document.getElementById('apptTrendEmpty');
    tbody.innerHTML = '';
    empty.style.display = data.trend.length === 0 ? 'block' : 'none';
    data.trend.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Period">${escapeHtml(r.bucket)}</td>
            <td data-label="Total">${r.total}</td>
            <td data-label="Confirmed">${r.confirmed}</td>
            <td data-label="Cancelled">${r.cancelled}</td>
            <td data-label="Completed">${r.completed}</td>
            <td data-label="No Show">${r.noShow}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ---- 2. Doctors ----
function renderDoctors(data) {
    ChartKit.renderBarChart(document.getElementById('chartDoctorTotal'), data.rows, {
        xKey: 'doctorName', yKey: 'total', color: ChartKit.palette()[0], formatLabel: (v) => 'Dr. ' + v
    });
    const utilRows = data.rows.filter(r => r.utilizationPct !== null);
    ChartKit.renderBarChart(document.getElementById('chartDoctorUtilization'), utilRows, {
        xKey: 'doctorName', yKey: 'utilizationPct', color: ChartKit.palette()[3],
        formatLabel: (v) => 'Dr. ' + v, formatValue: (v) => v + '%'
    });

    const tbody = document.getElementById('doctorsTableBody');
    const empty = document.getElementById('doctorsEmpty');
    tbody.innerHTML = '';
    empty.style.display = data.rows.length === 0 ? 'block' : 'none';
    data.rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Doctor">Dr. ${escapeHtml(r.doctorName)}</td>
            <td data-label="Department">${escapeHtml(r.departmentName)}</td>
            <td data-label="Branch">${escapeHtml(r.branchName)}</td>
            <td data-label="Total">${r.total}</td>
            <td data-label="Completed">${r.completed}</td>
            <td data-label="Cancelled">${r.cancelled}</td>
            <td data-label="No Show">${r.noShow}</td>
            <td data-label="Utilization %">${fmtNum(r.utilizationPct !== null ? r.utilizationPct + '%' : null)}</td>
            <td data-label="Avg Daily Load">${r.avgDailyLoad}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ---- 3. Departments ----
function renderDepartments(data) {
    document.getElementById('deptKpiGrid').innerHTML = [
        kpiCard('Most Booked', data.mostBooked || '—'),
        kpiCard('Least Booked', data.leastBooked || '—'),
        kpiCard('Departments With Activity', data.rows.length)
    ].join('');

    ChartKit.renderBarChart(document.getElementById('chartDeptTotal'), data.rows, {
        xKey: 'departmentName', yKey: 'total', color: ChartKit.palette()[1]
    });

    const tbody = document.getElementById('deptTableBody');
    const empty = document.getElementById('deptEmpty');
    tbody.innerHTML = '';
    empty.style.display = data.rows.length === 0 ? 'block' : 'none';
    data.rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Department">${escapeHtml(r.departmentName)}</td>
            <td data-label="Branch">${escapeHtml(r.branchName)}</td>
            <td data-label="Total Appointments">${r.total}</td>
            <td data-label="Patient Volume">${r.patientVolume}</td>
            <td data-label="Doctor Count">${r.doctorCount}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ---- 4. Branches ----
function renderBranches(data) {
    ChartKit.renderBarChart(document.getElementById('chartBranchTotal'), data.rows, {
        xKey: 'branchName', yKey: 'appointmentCount', color: ChartKit.palette()[2]
    });

    const tbody = document.getElementById('branchesTableBody');
    const empty = document.getElementById('branchesEmpty');
    tbody.innerHTML = '';
    empty.style.display = data.rows.length === 0 ? 'block' : 'none';
    data.rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Branch">${escapeHtml(r.branchName)}</td>
            <td data-label="Appointments">${r.appointmentCount}</td>
            <td data-label="Departments">${r.departmentCount}</td>
            <td data-label="Doctors">${r.doctorCount}</td>
            <td data-label="Patients">${r.patientCount}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ---- 5. Reception ----
function renderReception(data) {
    const k = data.kpis;
    document.getElementById('receptionKpiGrid').innerHTML = [
        kpiCard('Walk-ins', k.walkIns), kpiCard('Manual Bookings', k.manualBookings), kpiCard('Check-ins', k.checkIns),
        kpiCard('Avg Waiting Time', k.avgWaitingMinutes !== null ? k.avgWaitingMinutes + ' min' : 'N/A'),
        kpiCard('Avg Consultation Flow', k.avgConsultationMinutes !== null ? k.avgConsultationMinutes + ' min' : 'N/A')
    ].join('');
}

// ---- 6. Patients ----
function renderPatients(data) {
    const k = data.kpis;
    document.getElementById('patientKpiGrid').innerHTML = [
        kpiCard('New Patients', k.newPatients), kpiCard('Returning Patients', k.returningPatients),
        kpiCard('Repeat Visit % (all-time)', k.repeatVisitPercentage + '%')
    ].join('');

    ChartKit.renderBarChart(document.getElementById('chartGender'), data.genderDistribution, {
        xKey: 'gender', yKey: 'count', color: ChartKit.palette()[4]
    });
    ChartKit.renderBarChart(document.getElementById('chartAgeGroups'), data.ageGroups, {
        xKey: 'group', yKey: 'count', color: ChartKit.palette()[5]
    });
}

// ---- Tabs ----
document.querySelectorAll('.report-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.report-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.report-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        activeTab = btn.dataset.tab;
        document.getElementById(`panel-${activeTab}`).classList.add('active');
        loadTab(activeTab);
    });
});

// ---- Booking trend group-by toggle (Appointments tab only) ----
document.getElementById('groupByToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-group]');
    if (!btn) return;
    document.querySelectorAll('#groupByToggle button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentGroupBy = btn.dataset.group;
    loadTab('appointments');
});

// ---- Filters ----
document.getElementById('filterPeriod').addEventListener('change', () => {
    const isCustom = document.getElementById('filterPeriod').value === 'custom';
    document.getElementById('customRangeWrap').classList.toggle('show', isCustom);
});

async function loadFilterOptions() {
    if (!canViewReports) return;
    try {
        const res = await AdminAuth.authFetch('/api/admin/reports/analytics/filters');
        filterOptions = await res.json();

        const branchSelect = document.getElementById('filterBranch');
        filterOptions.branches.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.id; opt.textContent = b.name;
            branchSelect.appendChild(opt);
        });
        populateDepartmentOptions();
        populateDoctorOptions();
    } catch (err) {
        console.error('Failed to load filter options:', err);
    }
}

function populateDepartmentOptions() {
    const branchId = document.getElementById('filterBranch').value;
    const select = document.getElementById('filterDepartment');
    const currentValue = select.value;
    select.innerHTML = '<option value="">All departments</option>';
    filterOptions.departments
        .filter(d => !branchId || String(d.branchId) === branchId)
        .forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id; opt.textContent = d.name;
            select.appendChild(opt);
        });
    if ([...select.options].some(o => o.value === currentValue)) select.value = currentValue;
}

function populateDoctorOptions() {
    const departmentId = document.getElementById('filterDepartment').value;
    const select = document.getElementById('filterDoctor');
    const currentValue = select.value;
    select.innerHTML = '<option value="">All doctors</option>';
    filterOptions.doctors
        .filter(d => !departmentId || String(d.departmentId) === departmentId)
        .forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id; opt.textContent = 'Dr. ' + d.name;
            select.appendChild(opt);
        });
    if ([...select.options].some(o => o.value === currentValue)) select.value = currentValue;
}

document.getElementById('filterBranch').addEventListener('change', () => {
    populateDepartmentOptions();
    populateDoctorOptions();
});
document.getElementById('filterDepartment').addEventListener('change', populateDoctorOptions);

document.getElementById('applyFiltersBtn').addEventListener('click', () => loadTab(activeTab));

// ---- Export ----
async function downloadExport(format) {
    if (!canViewReports) return;
    const btn = format === 'csv' ? document.getElementById('exportCsvBtn') : document.getElementById('exportXlsxBtn');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    try {
        const query = buildFilterQuery({ type: activeTab, format });
        const res = await AdminAuth.authFetch(`/api/admin/reports/analytics/export?${query}`);
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || 'Export failed');
        }
        const disposition = res.headers.get('Content-Disposition') || '';
        const filenameMatch = /filename="([^"]+)"/.exec(disposition);
        const filename = filenameMatch ? filenameMatch[1] : `${activeTab}-report.${format}`;

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        Toast.show(err.message || 'Could not export report.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}
document.getElementById('exportCsvBtn').addEventListener('click', () => downloadExport('csv'));
document.getElementById('exportXlsxBtn').addEventListener('click', () => downloadExport('xlsx'));

// ---- Init ----
if (canViewReports) {
    loadFilterOptions().then(() => loadTab(activeTab));

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => loadTab(activeTab), 250);
    });
}
