// Auth guard, sidebar user block, logout, search, and activity are all
// wired centrally by topbar.js (loaded before this file).

let editingId = null; // null = add mode, otherwise the department id being edited
let currentPage = 1;
let searchDebounce = null;
let hasActiveBranch = true; // optimistic default until the first load resolves it

function openModal(mode, dept) {
    editingId = mode === 'edit' ? dept.id : null;
    document.getElementById('deptModalTitle').textContent = mode === 'edit' ? 'Edit Department' : 'Add Department';
    document.getElementById('formError').textContent = '';
    document.getElementById('deptForm').reset();

    if (mode === 'edit') {
        document.getElementById('fName').value = dept.name;
        document.getElementById('fNameHi').value = dept.name_hi || '';
        document.getElementById('fDescription').value = dept.description || '';
        document.getElementById('fDisplayOrder').value = dept.display_order || 0;
    } else {
        document.getElementById('fDisplayOrder').value = 0;
    }

    document.getElementById('deptModal').classList.add('show');
}

function closeModal() {
    document.getElementById('deptModal').classList.remove('show');
    editingId = null;
}

document.getElementById('addDeptBtn').addEventListener('click', () => {
    if (!hasActiveBranch) return; // belt-and-braces — the button is also disabled
    openModal('add');
});
// The Branches module now exists — this button navigates for real instead of
// being a disabled placeholder.
document.getElementById('createBranchBtn').addEventListener('click', () => {
    window.location.href = 'branches.html';
});
document.getElementById('cancelDeptBtn').addEventListener('click', closeModal);
document.getElementById('deptModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('deptModal')) closeModal();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('deptModal').classList.contains('show')) closeModal();
});

document.getElementById('deptForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorText = document.getElementById('formError');
    errorText.textContent = '';

    const body = {
        name: document.getElementById('fName').value.trim(),
        name_hi: document.getElementById('fNameHi').value.trim() || undefined,
        description: document.getElementById('fDescription').value.trim() || null,
        display_order: Number(document.getElementById('fDisplayOrder').value) || 0
    };

    const url = editingId ? `/api/admin/departments/${editingId}` : '/api/admin/departments';
    const method = editingId ? 'PUT' : 'POST';

    try {
        const res = await AdminAuth.authFetch(url, {
            method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { errorText.textContent = data.error || 'Failed to save department'; return; }
        closeModal();
        Toast.show(editingId ? 'Department updated.' : 'Department created.', 'success');
        loadDepartments();
    } catch (err) {
        errorText.textContent = 'Could not reach the server.';
    }
});

let deptsCache = [];

function statusPillHtml(status) {
    return status === 'Active'
        ? '<span class="status-pill active"><span class="status-dot"></span>Active</span>'
        : '<span class="status-pill inactive"><span class="status-dot"></span>Inactive</span>';
}

function renderRows(depts) {
    const tbody = document.getElementById('tableBody');
    const emptyState = document.getElementById('emptyState');
    tbody.innerHTML = '';

    if (depts.length === 0) {
        // The "no branch yet" reason takes priority over a plain search-miss
        // message — it's the more actionable, root-cause explanation.
        emptyState.textContent = !hasActiveBranch
            ? 'No branch exists yet. Please create a branch before creating departments.'
            : 'No departments match.';
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    depts.forEach(d => {
        const tr = document.createElement('tr');
        const toggleAction = d.status === 'Active'
            ? `<button class="action-btn outline" data-action="archive" data-id="${d.id}">Archive</button>`
            : `<button class="action-btn" data-action="restore" data-id="${d.id}">Restore</button>`;
        tr.innerHTML = `
            <td data-label="Name">${escapeHtml(d.name)}</td>
            <td data-label="Description">${escapeHtml(d.description || '—')}</td>
            <td data-label="Doctors">${d.doctor_count}</td>
            <td data-label="Order">${d.display_order}</td>
            <td data-label="Status">${statusPillHtml(d.status)}</td>
            <td data-label="Actions"><div class="actions-cell">
                <button class="action-btn" data-action="edit" data-id="${d.id}">Edit</button>
                ${toggleAction}
            </div></td>
        `;
        tbody.appendChild(tr);
    });
}

function updateBranchGate() {
    const addBtn = document.getElementById('addDeptBtn');
    const createBranchBtn = document.getElementById('createBranchBtn');
    const banner = document.getElementById('noBranchBanner');

    addBtn.disabled = !hasActiveBranch;
    addBtn.title = hasActiveBranch ? '' : 'Create a branch first — no active branch exists yet';
    createBranchBtn.style.display = hasActiveBranch ? 'none' : '';
    banner.style.display = hasActiveBranch ? 'none' : 'block';
}

function updatePagination(total, page, pageSize) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    document.getElementById('paginationInfo').textContent =
        total === 0 ? 'No departments' : `Page ${page} of ${totalPages} · ${total} department${total === 1 ? '' : 's'} total`;
    document.getElementById('prevPageBtn').disabled = page <= 1;
    document.getElementById('nextPageBtn').disabled = page >= totalPages;
}

async function loadDepartments() {
    const search = document.getElementById('deptSearch').value.trim();
    const status = document.getElementById('statusFilter').value;
    const params = new URLSearchParams({ page: currentPage, pageSize: 10 });
    if (search) params.set('search', search);
    if (status) params.set('status', status);

    try {
        const res = await AdminAuth.authFetch('/api/admin/departments/full?' + params.toString());
        const data = await res.json();

        if (!res.ok) {
            // Every Department API is Hospital-Administrator-only — a
            // Receptionist landing here directly (not via a hidden nav link,
            // since they can't submit anything anyway) gets a clear message
            // instead of a broken empty table.
            document.getElementById('addDeptBtn').style.display = 'none';
            document.getElementById('createBranchBtn').style.display = 'none';
            document.getElementById('noBranchBanner').style.display = 'none';
            document.querySelector('.dept-toolbar').style.display = 'none';
            document.getElementById('pagination').style.display = 'none';
            document.getElementById('tableBody').innerHTML = '';
            document.getElementById('emptyState').textContent = data.error || 'You do not have permission to view this page.';
            document.getElementById('emptyState').style.display = 'block';
            document.getElementById('deptCountSub').textContent = '';
            return;
        }

        hasActiveBranch = !!data.hasActiveBranch;
        updateBranchGate();

        deptsCache = data.departments;
        renderRows(deptsCache);
        updatePagination(data.total, data.page, data.pageSize);
        document.getElementById('deptCountSub').textContent = `${data.total} department${data.total === 1 ? '' : 's'} in total`;
    } catch (err) {
        console.error('Failed to load departments:', err);
    }
}

document.getElementById('tableBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === 'edit') {
        const dept = deptsCache.find(d => String(d.id) === id);
        if (dept) openModal('edit', dept);
        return;
    }

    if (action === 'archive') {
        const ok = await Confirm.show('Archive this department? It will be hidden behind the Inactive filter but can be restored anytime.', {
            title: 'Archive Department', confirmText: 'Archive'
        });
        if (!ok) return;
        const res = await AdminAuth.authFetch(`/api/admin/departments/${id}/archive`, { method: 'PATCH' });
        const data = await res.json();
        if (!res.ok) { Toast.show(data.error || 'Could not archive department', 'error'); return; }
        Toast.show('Department archived.', 'success');
        loadDepartments();
        return;
    }

    if (action === 'restore') {
        const res = await AdminAuth.authFetch(`/api/admin/departments/${id}/restore`, { method: 'PATCH' });
        if (!res.ok) { Toast.show('Could not restore department', 'error'); return; }
        Toast.show('Department restored.', 'success');
        loadDepartments();
    }
});

document.getElementById('deptSearch').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { currentPage = 1; loadDepartments(); }, 300);
});
document.getElementById('statusFilter').addEventListener('change', () => { currentPage = 1; loadDepartments(); });
document.getElementById('prevPageBtn').addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadDepartments(); } });
document.getElementById('nextPageBtn').addEventListener('click', () => { currentPage++; loadDepartments(); });

loadDepartments();
