PlatformAuth.requireAuth();

const hospitalId = new URLSearchParams(window.location.search).get('id');
let currentHospital = null;

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const ACTION_LABELS = {
    HospitalCreated: 'Hospital created',
    HospitalEdited: 'Hospital edited',
    HospitalSuspended: 'Hospital suspended',
    HospitalActivated: 'Hospital activated',
    HospitalAdminLogin: 'Hospital admin logged in',
    PlatformLogin: 'Platform admin logged in'
};

async function load() {
    if (!hospitalId) {
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('errorState').style.display = 'block';
        document.getElementById('errorState').textContent = 'No hospital id specified.';
        return;
    }

    try {
        const res = await PlatformAuth.authFetch(`/api/platform/hospitals/${hospitalId}`);
        if (res.status === 404) {
            document.getElementById('loadingState').style.display = 'none';
            document.getElementById('errorState').style.display = 'block';
            document.getElementById('errorState').textContent = 'Hospital not found.';
            return;
        }
        if (!res.ok) throw new Error('Request failed');

        const data = await res.json();
        currentHospital = data.hospital;
        render(data);

        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('detailContent').style.display = 'block';
    } catch (err) {
        console.error('Failed to load hospital detail:', err);
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('errorState').style.display = 'block';
        document.getElementById('errorState').textContent = 'Could not reach the server.';
    }
}

function fillTable(bodyId, emptyId, rows, rowHtmlFn) {
    const body = document.getElementById(bodyId);
    const empty = document.getElementById(emptyId);
    body.innerHTML = '';
    empty.style.display = rows.length === 0 ? 'block' : 'none';
    rows.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = rowHtmlFn(row);
        body.appendChild(tr);
    });
}

function render(data) {
    const h = data.hospital;
    document.getElementById('hospitalName').textContent = h.name;

    document.getElementById('healthBadgeWrap').innerHTML =
        `<span class="badge badge-${data.health.status.toLowerCase()}">${data.health.status}</span>`;
    document.getElementById('healthWarningsNote').textContent = data.health.warnings.length
        ? `Warnings: ${data.health.warnings.join(', ')}`
        : 'No health warnings — everything looks set up.';

    document.getElementById('statBranches').textContent = data.stats.branchCount;
    document.getElementById('statDepartments').textContent = data.stats.departmentCount;
    document.getElementById('statDoctors').textContent = data.stats.doctorCount;
    document.getElementById('statStaff').textContent = data.stats.staffCount;
    document.getElementById('statPatients').textContent = data.stats.patientCount;

    document.getElementById('infoStatus').innerHTML = `<span class="badge badge-${h.status.toLowerCase()}">${h.status}</span>`;
    document.getElementById('infoEmail').textContent = h.email || '—';
    document.getElementById('infoPhone').textContent = h.phone || '—';
    document.getElementById('infoCity').textContent = h.city || '—';
    document.getElementById('infoState').textContent = h.state || '—';
    document.getElementById('infoCountry').textContent = h.country || '—';
    document.getElementById('infoAddress').textContent = h.address || '—';
    document.getElementById('infoPincode').textContent = h.pincode || '—';
    document.getElementById('infoWhatsapp').textContent = h.whatsapp_business_phone_id ? '✅ Connected' : '— Not configured';
    document.getElementById('infoCreated').textContent = fmtDate(h.created_at);

    document.getElementById('subscriptionTier').textContent = data.subscription.planTier;
    document.getElementById('subscriptionNote').textContent = data.subscription.note;

    const toggleBtn = document.getElementById('toggleStatusBtn');
    toggleBtn.textContent = h.status === 'Active' ? '⛔ Suspend' : '✅ Activate';
    toggleBtn.className = h.status === 'Active' ? 'btn btn-danger' : 'btn btn-primary';

    fillTable('branchesTableBody', 'branchesEmpty', data.branches, b => `
        <td data-label="Name">${escapeHtml(b.name)}</td>
        <td data-label="Address">${escapeHtml(b.address || '—')}</td>
        <td data-label="Status"><span class="badge badge-${b.is_active ? 'active' : 'inactive'}">${b.is_active ? 'Active' : 'Inactive'}</span></td>
    `);

    fillTable('departmentsTableBody', 'departmentsEmpty', data.departments, d => `
        <td data-label="Name">${escapeHtml(d.name_en)}</td>
        <td data-label="Branch">${escapeHtml(d.branch_name)}</td>
        <td data-label="Status"><span class="badge badge-${d.status === 'Active' ? 'active' : 'inactive'}">${escapeHtml(d.status)}</span></td>
    `);

    fillTable('doctorsTableBody', 'doctorsEmpty', data.doctors, doc => `
        <td data-label="Name">Dr. ${escapeHtml(doc.name)}</td>
        <td data-label="Department">${escapeHtml(doc.department_name)}</td>
        <td data-label="Status">${doc.is_on_leave ? '<span class="badge badge-on-leave">On Leave</span>' : '<span class="badge badge-active">Active</span>'}</td>
    `);

    document.getElementById('patientsTotal').textContent = data.patients.total;
    fillTable('patientsTableBody', 'patientsEmpty', data.patients.recent, p => `
        <td data-label="Name">${escapeHtml(p.name)}</td>
        <td data-label="Phone">${escapeHtml(p.phone_number)}</td>
        <td data-label="UHID">${escapeHtml(p.uhid || '—')}</td>
        <td data-label="Registered">${fmtDate(p.created_at)}</td>
    `);

    document.getElementById('apptToday').textContent = data.appointmentsSummary.today;
    document.getElementById('apptMonth').textContent = data.appointmentsSummary.thisMonth;
    document.getElementById('apptConfirmed').textContent = data.appointmentsSummary.confirmed;
    document.getElementById('apptCompleted').textContent = data.appointmentsSummary.completed;
    document.getElementById('apptCancelled').textContent = data.appointmentsSummary.cancelled;

    fillTable('staffTableBody', 'staffEmpty', data.staff, s => `
        <td data-label="Name">${escapeHtml(s.name)}</td>
        <td data-label="Email">${escapeHtml(s.email)}</td>
        <td data-label="Role">${escapeHtml(s.role)}</td>
        <td data-label="Phone">${escapeHtml(s.phone_number || '—')}</td>
    `);

    fillTable('auditTableBody', 'auditEmpty', data.recentAudit, a => `
        <td data-label="Action">${escapeHtml(ACTION_LABELS[a.action_type] || a.action_type)}</td>
        <td data-label="By">${escapeHtml(a.actor_name || '—')}</td>
        <td data-label="When">${fmtDateTime(a.created_at)}</td>
    `);
}

document.getElementById('editBtn').addEventListener('click', () => {
    window.location.href = `hospitals.html?edit=${hospitalId}`;
});

document.getElementById('toggleStatusBtn').addEventListener('click', async () => {
    const goingTo = currentHospital.status === 'Active' ? 'Suspended' : 'Active';
    const ok = await Confirm.show(
        goingTo === 'Suspended'
            ? 'This hospital will immediately lose access to login, Reception, and WhatsApp booking. Continue?'
            : 'This will restore full access for this hospital. Continue?',
        { title: goingTo === 'Suspended' ? 'Suspend Hospital?' : 'Activate Hospital?', confirmText: goingTo, danger: goingTo === 'Suspended' }
    );
    if (!ok) return;

    try {
        const endpoint = goingTo === 'Suspended' ? 'suspend' : 'activate';
        const res = await PlatformAuth.authFetch(`/api/platform/hospitals/${hospitalId}/${endpoint}`, { method: 'PATCH' });
        const data = await res.json();
        if (!res.ok) { Toast.show(data.error || 'Action failed', 'error'); return; }
        Toast.show(`Hospital ${goingTo === 'Suspended' ? 'suspended' : 'activated'}.`, 'success');
        load();
    } catch (err) {
        Toast.show('Could not reach the server.', 'error');
    }
});

load();
