// Auth guard, sidebar user block, logout, search, and activity are all
// wired centrally by topbar.js (loaded before this file).

const ROLES = ['Receptionist', 'Hospital Administrator', 'Super Admin'];
const currentAdminId = (AdminAuth.getAdmin() || {}).id;

document.getElementById('addStaffBtn').addEventListener('click', () => {
    document.getElementById('staffForm').reset();
    document.getElementById('formError').textContent = '';
    document.getElementById('formPanel').style.display = 'block';
    document.getElementById('formPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('cancelFormBtn').addEventListener('click', () => {
    document.getElementById('formPanel').style.display = 'none';
});

document.getElementById('staffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorText = document.getElementById('formError');
    errorText.textContent = '';

    const body = {
        name: document.getElementById('fName').value.trim(),
        email: document.getElementById('fEmail').value.trim(),
        phone_number: document.getElementById('fPhone').value.trim() || null,
        role: document.getElementById('fRole').value,
        password: document.getElementById('fPassword').value
    };

    try {
        const res = await AdminAuth.authFetch('/api/admin/staff', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { errorText.textContent = data.error || 'Failed to add staff'; return; }
        document.getElementById('formPanel').style.display = 'none';
        Toast.show('Staff account created.', 'success');
        loadStaff();
    } catch (err) {
        errorText.textContent = 'Could not reach the server.';
    }
});

function roleSelectHtml(staff) {
    const opts = ROLES.map(r => `<option value="${r}" ${r === staff.role ? 'selected' : ''}>${r}</option>`).join('');
    return `<select class="role-select" data-role-for="${staff.id}">${opts}</select>`;
}

async function loadStaff() {
    try {
        const res = await AdminAuth.authFetch('/api/admin/staff');
        const data = await res.json();

        const tbody = document.getElementById('tableBody');
        const emptyState = document.getElementById('emptyState');
        tbody.innerHTML = '';

        if (data.staff.length === 0) {
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
            data.staff.forEach(s => {
                const isSelf = String(s.id) === String(currentAdminId);
                const joined = new Date(s.created_at).toLocaleDateString();
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td data-label="Name"><div class="name-cell">${Avatar.html(s.name)}<span>${escapeHtml(s.name)}</span>${isSelf ? '<span class="self-tag">(You)</span>' : ''}</div></td>
                    <td data-label="Email">${escapeHtml(s.email)}</td>
                    <td data-label="Phone">${escapeHtml(s.phone_number || '—')}</td>
                    <td data-label="Role">${isSelf ? escapeHtml(s.role) : roleSelectHtml(s)}</td>
                    <td data-label="Joined">${joined}</td>
                    <td data-label="Actions"><div class="actions-cell">${isSelf ? '' : `<button class="action-btn danger" data-delete="${s.id}">Remove</button>`}</div></td>
                `;
                tbody.appendChild(tr);
            });
        }

        document.getElementById('staffCountSub').textContent = `${data.staff.length} staff member${data.staff.length === 1 ? '' : 's'}`;
    } catch (err) {
        console.error('Failed to load staff:', err);
    }
}

document.getElementById('tableBody').addEventListener('change', async (e) => {
    const select = e.target.closest('[data-role-for]');
    if (!select) return;
    const id = select.dataset.roleFor;
    try {
        const res = await AdminAuth.authFetch(`/api/admin/staff/${id}/role`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: select.value })
        });
        const data = await res.json();
        if (!res.ok) { Toast.show(data.error || 'Could not change role', 'error'); loadStaff(); return; }
        Toast.show('Role updated.', 'success');
        loadStaff();
    } catch (err) {
        Toast.show('Could not reach the server.', 'error');
        loadStaff();
    }
});

document.getElementById('tableBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const ok = await Confirm.show('Remove this staff member? They will immediately lose access.', {
        title: 'Remove Staff', confirmText: 'Remove', danger: true
    });
    if (!ok) return;
    const res = await AdminAuth.authFetch(`/api/admin/staff/${btn.dataset.delete}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { Toast.show(data.error || 'Could not remove staff', 'error'); return; }
    Toast.show('Staff removed.', 'success');
    loadStaff();
});

loadStaff();
