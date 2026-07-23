PlatformAuth.requireAuth();

let currentPage = 1;
let currentPagination = null;
let modalMode = 'create'; // 'create' | 'edit'
let editingPlanId = null;

const LIMIT_FIELDS = [
    ['fMaxBranches', 'max_branches'], ['fMaxDepartments', 'max_departments'],
    ['fMaxDoctors', 'max_doctors'], ['fMaxStaff', 'max_staff'],
    ['fMaxAppointments', 'max_monthly_appointments'], ['fMaxWhatsapp', 'max_monthly_whatsapp_conversations']
];
const MODULE_FIELDS = [
    ['fReportsModule', 'reports_module'], ['fReceptionModule', 'reception_module'],
    ['fAnalyticsModule', 'analytics_module'], ['fApiAccess', 'api_access'], ['fMultiBranchSupport', 'multi_branch_support']
];
const MODULE_LABELS = { reports_module: 'Reports', reception_module: 'Reception', analytics_module: 'Analytics', api_access: 'API Access', multi_branch_support: 'Multi-Branch' };

function fmtLimit(v) { return (v === null || v === undefined) ? '∞ Unlimited' : v; }

function moduleCountCell(plan) {
    const enabled = MODULE_FIELDS.map(([, field]) => field).filter(field => plan[field]);
    const title = enabled.length ? enabled.map(f => MODULE_LABELS[f]).join(', ') : 'No modules enabled';
    return `<span class="module-count" title="${escapeHtml(title)}">${enabled.length}/5</span>`;
}

function showLoading() {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('tableWrap').style.display = 'none';
}
function showError(message) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('errorState').textContent = message;
    document.getElementById('tableWrap').style.display = 'none';
}
function showTable() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('tableWrap').style.display = 'block';
}

async function loadPlans(page = 1) {
    showLoading();
    currentPage = page;
    const status = document.getElementById('statusFilter').value;
    const params = new URLSearchParams({ page, pageSize: 20 });
    if (status) params.set('status', status);

    try {
        const res = await PlatformAuth.authFetch(`/api/platform/plans?${params.toString()}`);
        if (!res.ok) { showError('Could not load plans.'); return; }
        const data = await res.json();
        renderTable(data.plans);
        renderPagination(data.pagination);
        showTable();
    } catch (err) {
        console.error('Failed to load plans:', err);
        showError('Could not reach the server.');
    }
}

function renderTable(plans) {
    const tbody = document.getElementById('tableBody');
    const empty = document.getElementById('emptyState');
    tbody.innerHTML = '';
    empty.style.display = plans.length === 0 ? 'block' : 'none';

    plans.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Name">${escapeHtml(p.name)}</td>
            <td data-label="Branches" class="limit-val">${fmtLimit(p.max_branches)}</td>
            <td data-label="Depts" class="limit-val">${fmtLimit(p.max_departments)}</td>
            <td data-label="Doctors" class="limit-val">${fmtLimit(p.max_doctors)}</td>
            <td data-label="Staff" class="limit-val">${fmtLimit(p.max_staff)}</td>
            <td data-label="Monthly Appts" class="limit-val">${fmtLimit(p.max_monthly_appointments)}</td>
            <td data-label="Monthly WhatsApp" class="limit-val">${fmtLimit(p.max_monthly_whatsapp_conversations)}</td>
            <td data-label="Modules">${moduleCountCell(p)}</td>
            <td data-label="Hospitals">${p.hospital_count}</td>
            <td data-label="Status"><span class="badge badge-${p.status.toLowerCase()}">${p.status}</span></td>
            <td data-label="Actions">
                <div class="actions-cell">
                    <button type="button" class="action-btn action-edit" data-edit-id="${p.id}">Edit</button>
                    <button type="button" class="action-btn ${p.status === 'Active' ? 'action-archive' : 'action-restore'}" data-toggle-id="${p.id}" data-toggle-status="${p.status}">
                        ${p.status === 'Active' ? 'Archive' : 'Restore'}
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-edit-id]').forEach(btn => btn.addEventListener('click', () => openEditModal(btn.dataset.editId)));
    tbody.querySelectorAll('[data-toggle-id]').forEach(btn => btn.addEventListener('click', () => toggleArchive(btn.dataset.toggleId, btn.dataset.toggleStatus)));
}

function renderPagination(pagination) {
    currentPagination = pagination;
    document.getElementById('paginationInfo').textContent =
        `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} plan${pagination.total === 1 ? '' : 's'})`;
    document.getElementById('prevPageBtn').disabled = pagination.page <= 1;
    document.getElementById('nextPageBtn').disabled = pagination.page >= pagination.totalPages;
}

document.getElementById('prevPageBtn').addEventListener('click', () => { if (currentPagination.page > 1) loadPlans(currentPagination.page - 1); });
document.getElementById('nextPageBtn').addEventListener('click', () => { if (currentPagination.page < currentPagination.totalPages) loadPlans(currentPagination.page + 1); });
document.getElementById('statusFilter').addEventListener('change', () => loadPlans(1));

async function toggleArchive(planId, currentStatus) {
    const goingTo = currentStatus === 'Active' ? 'Archived' : 'Active';
    const ok = await Confirm.show(
        goingTo === 'Archived'
            ? 'Archived plans can no longer be assigned to new hospitals. Hospitals already on this plan are unaffected. Continue?'
            : 'This plan will become assignable to hospitals again. Continue?',
        { title: goingTo === 'Archived' ? 'Archive Plan?' : 'Restore Plan?', confirmText: goingTo === 'Archived' ? 'Archive' : 'Restore', danger: goingTo === 'Archived' }
    );
    if (!ok) return;

    try {
        const endpoint = goingTo === 'Archived' ? 'archive' : 'restore';
        const res = await PlatformAuth.authFetch(`/api/platform/plans/${planId}/${endpoint}`, { method: 'PATCH' });
        const data = await res.json();
        if (!res.ok) { Toast.show(data.error || 'Action failed', 'error'); return; }
        Toast.show(`Plan ${goingTo === 'Archived' ? 'archived' : 'restored'}.`, 'success');
        loadPlans(currentPage);
    } catch (err) {
        Toast.show('Could not reach the server.', 'error');
    }
}

// ---- Create / Edit modal ----
const planModal = document.getElementById('planModal');
function clearForm() {
    document.getElementById('fPlanName').value = '';
    LIMIT_FIELDS.forEach(([id]) => { document.getElementById(id).value = ''; });
    MODULE_FIELDS.forEach(([id]) => { document.getElementById(id).checked = false; });
}
function openCreateModal() {
    modalMode = 'create';
    editingPlanId = null;
    document.getElementById('planModalTitle').textContent = '📦 Create Plan';
    document.getElementById('planModalError').textContent = '';
    clearForm();
    planModal.classList.add('show');
}

async function openEditModal(planId) {
    modalMode = 'edit';
    editingPlanId = planId;
    document.getElementById('planModalTitle').textContent = '✏️ Edit Plan';
    document.getElementById('planModalError').textContent = '';

    const res = await PlatformAuth.authFetch(`/api/platform/plans/${planId}`);
    const p = await res.json();
    document.getElementById('fPlanName').value = p.name || '';
    LIMIT_FIELDS.forEach(([id, field]) => { document.getElementById(id).value = (p[field] === null || p[field] === undefined) ? '' : p[field]; });
    MODULE_FIELDS.forEach(([id, field]) => { document.getElementById(id).checked = !!p[field]; });
    planModal.classList.add('show');
}

document.getElementById('createPlanBtn').addEventListener('click', openCreateModal);
document.getElementById('planModalCancelBtn').addEventListener('click', () => planModal.classList.remove('show'));
planModal.addEventListener('click', (e) => { if (e.target === planModal) planModal.classList.remove('show'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && planModal.classList.contains('show')) planModal.classList.remove('show'); });

document.getElementById('planModalSaveBtn').addEventListener('click', async () => {
    const errorEl = document.getElementById('planModalError');
    errorEl.textContent = '';

    const body = { name: document.getElementById('fPlanName').value.trim() };
    LIMIT_FIELDS.forEach(([id, field]) => { body[field] = document.getElementById(id).value.trim(); });
    MODULE_FIELDS.forEach(([id, field]) => { body[field] = document.getElementById(id).checked; });

    if (!body.name) { errorEl.textContent = 'Plan name is required'; return; }

    const url = modalMode === 'create' ? '/api/platform/plans' : `/api/platform/plans/${editingPlanId}`;
    const method = modalMode === 'create' ? 'POST' : 'PUT';

    try {
        const res = await PlatformAuth.authFetch(url, {
            method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.error || 'Save failed'; return; }

        planModal.classList.remove('show');
        Toast.show(modalMode === 'create' ? 'Plan created.' : 'Plan updated.', 'success');
        loadPlans(modalMode === 'create' ? 1 : currentPage);
    } catch (err) {
        errorEl.textContent = 'Could not reach the server.';
    }
});

loadPlans(1);
