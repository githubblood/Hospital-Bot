PlatformAuth.requireAuth();

const PAGE_SIZE = 25;
let currentPage = 1;
let currentTotal = 0;

const ACTION_LABELS = {
    HospitalCreated: 'Hospital Created',
    HospitalEdited: 'Hospital Edited',
    HospitalSuspended: 'Hospital Suspended',
    HospitalActivated: 'Hospital Activated',
    HospitalAdminLogin: 'Hospital Login',
    PlatformLogin: 'Platform Login'
};

function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function summarizeDetails(entry) {
    if (entry.action_type === 'HospitalAdminLogin' || entry.action_type === 'PlatformLogin') {
        return entry.user_agent ? entry.user_agent.slice(0, 60) : '—';
    }
    if (!entry.details) return '—';
    if (entry.action_type === 'HospitalCreated' && entry.details.adminEmail) {
        return `First admin: ${entry.details.adminEmail}`;
    }
    if (entry.action_type === 'HospitalEdited' && entry.details.changes) {
        const fields = Object.keys(entry.details.changes);
        return fields.length ? `Changed: ${fields.join(', ')}` : 'No field changes';
    }
    return '—';
}

async function load(page = 1) {
    currentPage = page;
    const hospitalId = document.getElementById('hospitalIdFilter').value.trim();
    const actionType = document.getElementById('actionTypeFilter').value;
    const offset = (page - 1) * PAGE_SIZE;

    const params = new URLSearchParams({ limit: PAGE_SIZE, offset });
    if (hospitalId) params.set('hospitalId', hospitalId);
    if (actionType) params.set('actionType', actionType);

    try {
        const res = await PlatformAuth.authFetch(`/api/platform/audit-log?${params.toString()}`);
        const data = await res.json();
        currentTotal = data.total;
        renderTable(data.entries);
        renderPagination();
    } catch (err) {
        console.error('Failed to load activity feed:', err);
        Toast.show('Could not reach the server.', 'error');
    }
}

function renderTable(entries) {
    const tbody = document.getElementById('tableBody');
    const empty = document.getElementById('emptyState');
    tbody.innerHTML = '';
    empty.style.display = entries.length === 0 ? 'block' : 'none';

    entries.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Action"><span class="action-type-badge action-${e.action_type}">${escapeHtml(ACTION_LABELS[e.action_type] || e.action_type)}</span></td>
            <td data-label="Hospital">${e.hospital_id ? `<a href="hospital-detail.html?id=${e.hospital_id}">${escapeHtml(e.hospital_name || ('#' + e.hospital_id))}</a>` : '—'}</td>
            <td data-label="By">${escapeHtml(e.actor_name || '—')} <small style="color:var(--text-muted);">(${e.actor_type === 'HospitalAdmin' ? 'Hospital Admin' : 'Platform'})</small></td>
            <td data-label="Details" class="details-cell">${escapeHtml(summarizeDetails(e))}</td>
            <td data-label="IP Address">${escapeHtml(e.ip_address || '—')}</td>
            <td data-label="When">${fmtDateTime(e.created_at)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(currentTotal / PAGE_SIZE));
    document.getElementById('paginationInfo').textContent = `Page ${currentPage} of ${totalPages} (${currentTotal} entr${currentTotal === 1 ? 'y' : 'ies'})`;
    document.getElementById('prevPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
}

document.getElementById('prevPageBtn').addEventListener('click', () => { if (currentPage > 1) load(currentPage - 1); });
document.getElementById('nextPageBtn').addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(currentTotal / PAGE_SIZE));
    if (currentPage < totalPages) load(currentPage + 1);
});
document.getElementById('applyFilterBtn').addEventListener('click', () => load(1));
document.getElementById('hospitalIdFilter').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(1); });
document.getElementById('actionTypeFilter').addEventListener('change', () => load(1));

// Deep link support: hospital-detail.html could later add a "view audit
// history" link here as audit-log.html?hospitalId=<id>.
const initialHospitalId = new URLSearchParams(window.location.search).get('hospitalId');
if (initialHospitalId) document.getElementById('hospitalIdFilter').value = initialHospitalId;

load(1);
