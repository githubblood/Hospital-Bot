PlatformAuth.requireAuth();

let currentPage = 1;
let currentPagination = null;
let modalMode = 'create'; // 'create' | 'edit'
let editingHospitalId = null;
let searchDebounceTimer = null;

function statusBadge(status) {
    return `<span class="badge badge-${status.toLowerCase()}">${status}</span>`;
}

function healthBadge(health) {
    const title = health.warnings.length ? health.warnings.join(', ') : 'No issues found';
    return `<span class="badge badge-${health.status.toLowerCase()}" title="${escapeHtml(title)}">${health.status}</span>`;
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

async function loadHospitals(page = 1) {
    showLoading();
    currentPage = page;
    const search = document.getElementById('searchInput').value.trim();
    const status = document.getElementById('statusFilter').value;

    const params = new URLSearchParams({ page, pageSize: 20 });
    if (search) params.set('search', search);
    if (status) params.set('status', status);

    try {
        const res = await PlatformAuth.authFetch(`/api/platform/hospitals?${params.toString()}`);
        if (!res.ok) { showError('Could not load hospitals.'); return; }
        const data = await res.json();
        renderTable(data.hospitals);
        renderPagination(data.pagination);
        showTable();
    } catch (err) {
        console.error('Failed to load hospitals:', err);
        showError('Could not reach the server.');
    }
}

function renderTable(hospitals) {
    const tbody = document.getElementById('tableBody');
    const empty = document.getElementById('emptyState');
    tbody.innerHTML = '';
    empty.style.display = hospitals.length === 0 ? 'block' : 'none';

    hospitals.forEach(h => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Name"><a href="hospital-detail.html?id=${h.id}">${escapeHtml(h.name)}</a></td>
            <td data-label="Email">${escapeHtml(h.email || '—')}</td>
            <td data-label="City">${escapeHtml(h.city || '—')}</td>
            <td data-label="Status">${statusBadge(h.status)}</td>
            <td data-label="Health">${healthBadge(h.health)}</td>
            <td data-label="Branches">${h.branch_count}</td>
            <td data-label="Staff">${h.staff_count}</td>
            <td data-label="WhatsApp">${h.hasWhatsapp ? '✅' : '—'}</td>
            <td data-label="Actions">
                <div class="actions-cell">
                    <a class="action-btn action-view" href="hospital-detail.html?id=${h.id}">View</a>
                    <button type="button" class="action-btn action-edit" data-edit-id="${h.id}">Edit</button>
                    <button type="button" class="action-btn ${h.status === 'Active' ? 'action-suspend' : 'action-activate'}" data-toggle-id="${h.id}" data-toggle-status="${h.status}">
                        ${h.status === 'Active' ? 'Suspend' : 'Activate'}
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-toggle-id]').forEach(btn => {
        btn.addEventListener('click', () => toggleStatus(btn.dataset.toggleId, btn.dataset.toggleStatus));
    });
    tbody.querySelectorAll('[data-edit-id]').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.editId));
    });
}

function renderPagination(pagination) {
    currentPagination = pagination;
    document.getElementById('paginationInfo').textContent =
        `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} hospital${pagination.total === 1 ? '' : 's'})`;
    document.getElementById('prevPageBtn').disabled = pagination.page <= 1;
    document.getElementById('nextPageBtn').disabled = pagination.page >= pagination.totalPages;
}

document.getElementById('prevPageBtn').addEventListener('click', () => { if (currentPagination.page > 1) loadHospitals(currentPagination.page - 1); });
document.getElementById('nextPageBtn').addEventListener('click', () => { if (currentPagination.page < currentPagination.totalPages) loadHospitals(currentPagination.page + 1); });

document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => loadHospitals(1), 350);
});
document.getElementById('statusFilter').addEventListener('change', () => loadHospitals(1));

async function toggleStatus(hospitalId, currentStatus) {
    const goingTo = currentStatus === 'Active' ? 'Suspended' : 'Active';
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
        loadHospitals(currentPage);
    } catch (err) {
        Toast.show('Could not reach the server.', 'error');
    }
}

// ---- Create / Edit modal ----
const hospitalModal = document.getElementById('hospitalModal');
function openCreateModal() {
    modalMode = 'create';
    editingHospitalId = null;
    document.getElementById('hospitalModalTitle').textContent = '🏥 Create Hospital';
    document.getElementById('createOnlyFields').style.display = 'block';
    ['fName', 'fEmail', 'fPhone', 'fCity', 'fState', 'fCountry', 'fAddress', 'fPincode', 'fAdminName', 'fAdminEmail', 'fAdminPhone', 'fAdminPassword']
        .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('hospitalModalError').textContent = '';
    hospitalModal.classList.add('show');
}

async function openEditModal(hospitalId) {
    modalMode = 'edit';
    editingHospitalId = hospitalId;
    document.getElementById('hospitalModalTitle').textContent = '✏️ Edit Hospital';
    document.getElementById('createOnlyFields').style.display = 'none';
    document.getElementById('hospitalModalError').textContent = '';

    const res = await PlatformAuth.authFetch(`/api/platform/hospitals/${hospitalId}`);
    const data = await res.json();
    const h = data.hospital;
    document.getElementById('fName').value = h.name || '';
    document.getElementById('fEmail').value = h.email || '';
    document.getElementById('fPhone').value = h.phone || '';
    document.getElementById('fCity').value = h.city || '';
    document.getElementById('fState').value = h.state || '';
    document.getElementById('fCountry').value = h.country || '';
    document.getElementById('fAddress').value = h.address || '';
    document.getElementById('fPincode').value = h.pincode || '';
    hospitalModal.classList.add('show');
}

document.getElementById('createHospitalBtn').addEventListener('click', openCreateModal);
document.getElementById('hospitalModalCancelBtn').addEventListener('click', () => hospitalModal.classList.remove('show'));
hospitalModal.addEventListener('click', (e) => { if (e.target === hospitalModal) hospitalModal.classList.remove('show'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && hospitalModal.classList.contains('show')) hospitalModal.classList.remove('show'); });

document.getElementById('hospitalModalSaveBtn').addEventListener('click', async () => {
    const errorEl = document.getElementById('hospitalModalError');
    errorEl.textContent = '';

    const body = {
        name: document.getElementById('fName').value.trim(),
        email: document.getElementById('fEmail').value.trim(),
        phone: document.getElementById('fPhone').value.trim(),
        city: document.getElementById('fCity').value.trim(),
        state: document.getElementById('fState').value.trim(),
        country: document.getElementById('fCountry').value.trim(),
        address: document.getElementById('fAddress').value.trim(),
        pincode: document.getElementById('fPincode').value.trim()
    };
    if (modalMode === 'create') {
        body.admin_name = document.getElementById('fAdminName').value.trim();
        body.admin_email = document.getElementById('fAdminEmail').value.trim();
        body.admin_phone = document.getElementById('fAdminPhone').value.trim();
        body.admin_password = document.getElementById('fAdminPassword').value;
    }

    const url = modalMode === 'create' ? '/api/platform/hospitals' : `/api/platform/hospitals/${editingHospitalId}`;
    const method = modalMode === 'create' ? 'POST' : 'PUT';

    try {
        const res = await PlatformAuth.authFetch(url, {
            method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.error || 'Save failed'; return; }

        hospitalModal.classList.remove('show');
        Toast.show(modalMode === 'create' ? 'Hospital created.' : 'Hospital updated.', 'success');
        loadHospitals(modalMode === 'create' ? 1 : currentPage);
    } catch (err) {
        errorEl.textContent = 'Could not reach the server.';
    }
});

loadHospitals(1).then(() => {
    // Deep link support: hospital-detail.html's Edit button links here as
    // hospitals.html?edit=<id> rather than duplicating this modal on a
    // second page.
    const editId = new URLSearchParams(window.location.search).get('edit');
    if (editId) openEditModal(editId);
});
