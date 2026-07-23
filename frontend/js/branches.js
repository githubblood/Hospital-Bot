// Auth guard, sidebar user block, logout, search, and activity are all
// wired centrally by topbar.js (loaded before this file).

let editingId = null; // null = add mode, otherwise the branch id being edited
let currentPage = 1;
let searchDebounce = null;

function openModal(mode, branch) {
    editingId = mode === 'edit' ? branch.id : null;
    document.getElementById('branchModalTitle').textContent = mode === 'edit' ? 'Edit Branch' : 'Add Branch';
    document.getElementById('formError').textContent = '';
    document.getElementById('branchForm').reset();

    if (mode === 'edit') {
        document.getElementById('fName').value = branch.name;
        document.getElementById('fAddress').value = branch.address || '';
        document.getElementById('fPhone').value = branch.phone || '';
        document.getElementById('fEmail').value = branch.email || '';
    }

    document.getElementById('branchModal').classList.add('show');
}

function closeModal() {
    document.getElementById('branchModal').classList.remove('show');
    editingId = null;
}

document.getElementById('addBranchBtn').addEventListener('click', () => openModal('add'));
document.getElementById('cancelBranchBtn').addEventListener('click', closeModal);
document.getElementById('branchModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('branchModal')) closeModal();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('branchModal').classList.contains('show')) closeModal();
});

document.getElementById('branchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorText = document.getElementById('formError');
    errorText.textContent = '';

    const body = {
        name: document.getElementById('fName').value.trim(),
        address: document.getElementById('fAddress').value.trim(),
        phone: document.getElementById('fPhone').value.trim() || null,
        email: document.getElementById('fEmail').value.trim() || null
    };

    const url = editingId ? `/api/admin/branches/${editingId}` : '/api/admin/branches';
    const method = editingId ? 'PUT' : 'POST';

    try {
        const res = await AdminAuth.authFetch(url, {
            method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { errorText.textContent = data.error || 'Failed to save branch'; return; }
        closeModal();
        Toast.show(editingId ? 'Branch updated.' : 'Branch created.', 'success');
        loadBranches();
    } catch (err) {
        errorText.textContent = 'Could not reach the server.';
    }
});

let branchesCache = [];

function statusPillHtml(status) {
    return status === 'Active'
        ? '<span class="status-pill active"><span class="status-dot"></span>Active</span>'
        : '<span class="status-pill inactive"><span class="status-dot"></span>Inactive</span>';
}

function renderRows(branches) {
    const tbody = document.getElementById('tableBody');
    const emptyState = document.getElementById('emptyState');
    tbody.innerHTML = '';

    if (branches.length === 0) {
        emptyState.textContent = 'No branches match.';
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    branches.forEach(b => {
        const tr = document.createElement('tr');
        const toggleAction = b.status === 'Active'
            ? `<button class="action-btn outline" data-action="archive" data-id="${b.id}">Archive</button>`
            : `<button class="action-btn" data-action="restore" data-id="${b.id}">Restore</button>`;
        tr.innerHTML = `
            <td data-label="Name">${escapeHtml(b.name)}</td>
            <td data-label="Address">${escapeHtml(b.address || '—')}</td>
            <td data-label="Phone">${escapeHtml(b.phone || '—')}</td>
            <td data-label="Email">${escapeHtml(b.email || '—')}</td>
            <td data-label="Departments">${b.active_department_count}</td>
            <td data-label="Created">${new Date(b.created_at).toLocaleDateString()}</td>
            <td data-label="Updated">${new Date(b.updated_at).toLocaleDateString()}</td>
            <td data-label="Status">${statusPillHtml(b.status)}</td>
            <td data-label="Actions"><div class="actions-cell">
                <button class="action-btn" data-action="edit" data-id="${b.id}">Edit</button>
                ${toggleAction}
            </div></td>
        `;
        tbody.appendChild(tr);
    });
}

function updatePagination(total, page, pageSize) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    document.getElementById('paginationInfo').textContent =
        total === 0 ? 'No branches' : `Page ${page} of ${totalPages} · ${total} branch${total === 1 ? '' : 'es'} total`;
    document.getElementById('prevPageBtn').disabled = page <= 1;
    document.getElementById('nextPageBtn').disabled = page >= totalPages;
}

function showLoading() {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('branchTable').style.display = 'none';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('pagination').style.display = 'none';
}

function showError(message) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorStateText').textContent = message;
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('branchTable').style.display = 'none';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('pagination').style.display = 'none';
}

function showLoaded() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('branchTable').style.display = '';
    document.getElementById('pagination').style.display = 'flex';
}

async function loadBranches() {
    const search = document.getElementById('branchSearch').value.trim();
    const status = document.getElementById('statusFilter').value;
    const params = new URLSearchParams({ page: currentPage, pageSize: 10 });
    if (search) params.set('search', search);
    if (status) params.set('status', status);

    showLoading();
    try {
        const res = await AdminAuth.authFetch('/api/admin/branches?' + params.toString());
        const data = await res.json();

        if (!res.ok) {
            showError(data.error || 'Could not load branches. Please try again.');
            return;
        }

        showLoaded();
        branchesCache = data.branches;
        renderRows(branchesCache);
        updatePagination(data.total, data.page, data.pageSize);
        document.getElementById('branchCountSub').textContent = `${data.total} branch${data.total === 1 ? '' : 'es'} in total`;
    } catch (err) {
        showError('Could not reach the server. Please try again.');
    }
}

document.getElementById('retryLoadBtn').addEventListener('click', loadBranches);

document.getElementById('tableBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === 'edit') {
        const branch = branchesCache.find(b => String(b.id) === id);
        if (branch) openModal('edit', branch);
        return;
    }

    if (action === 'archive') {
        const ok = await Confirm.show('Archive this branch? It will be hidden behind the Inactive filter but can be restored anytime.', {
            title: 'Archive Branch', confirmText: 'Archive'
        });
        if (!ok) return;
        const res = await AdminAuth.authFetch(`/api/admin/branches/${id}/archive`, { method: 'PATCH' });
        const data = await res.json();
        if (!res.ok) { Toast.show(data.error || 'Could not archive branch', 'error'); return; }
        Toast.show('Branch archived.', 'success');
        loadBranches();
        return;
    }

    if (action === 'restore') {
        const res = await AdminAuth.authFetch(`/api/admin/branches/${id}/restore`, { method: 'PATCH' });
        const data = await res.json();
        if (!res.ok) { Toast.show(data.error || 'Could not restore branch', 'error'); return; }
        Toast.show('Branch restored.', 'success');
        loadBranches();
    }
});

document.getElementById('branchSearch').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { currentPage = 1; loadBranches(); }, 300);
});
document.getElementById('statusFilter').addEventListener('change', () => { currentPage = 1; loadBranches(); });
document.getElementById('prevPageBtn').addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadBranches(); } });
document.getElementById('nextPageBtn').addEventListener('click', () => { currentPage++; loadBranches(); });

loadBranches();
