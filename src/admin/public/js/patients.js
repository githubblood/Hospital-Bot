// Auth guard, sidebar user block, logout, search, and activity are all
// wired centrally by topbar.js (loaded before this file).

function statusBadge(status) {
    return `<span class="badge badge-${status.toLowerCase()}">${status}</span>`;
}

let searchDebounce = null;

async function loadPatients() {
    const search = document.getElementById('searchInput').value.trim();
    const params = new URLSearchParams();
    if (search) params.set('search', search);

    try {
        const res = await AdminAuth.authFetch('/api/admin/patients?' + params.toString());
        const data = await res.json();

        const tbody = document.getElementById('tableBody');
        const emptyState = document.getElementById('emptyState');
        tbody.innerHTML = '';

        if (data.patients.length === 0) {
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
            data.patients.forEach(p => {
                const tr = document.createElement('tr');
                const registered = new Date(p.created_at).toLocaleDateString();
                tr.innerHTML = `
                    <td data-label="Name"><div class="name-cell">${Avatar.html(p.name)}<span>${escapeHtml(p.name)}</span></div></td>
                    <td data-label="Phone">${escapeHtml(p.phone_number)}</td>
                    <td data-label="Age">${p.age}</td>
                    <td data-label="Gender">${p.gender}</td>
                    <td data-label="Registered">${registered}</td>
                    <td data-label="Appointments">${p.appointment_count}</td>
                    <td data-label="Actions"><button class="action-btn" data-id="${p.id}">View History</button></td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        console.error('Failed to load patients:', err);
    }
}

async function showHistory(patientId) {
    try {
        const res = await AdminAuth.authFetch(`/api/admin/patients/${patientId}`);
        if (!res.ok) {
            alert('Could not load patient history');
            return;
        }
        const patient = await res.json();

        document.getElementById('historyName').textContent = patient.name;
        document.getElementById('historySub').textContent =
            `${patient.phone_number} · ${patient.age} yrs · ${patient.gender}`;

        const tbody = document.getElementById('historyTableBody');
        const emptyState = document.getElementById('historyEmpty');
        tbody.innerHTML = '';

        if (patient.history.length === 0) {
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
            patient.history.forEach(h => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td data-label="Doctor">Dr. ${escapeHtml(h.doctor_name)}</td>
                    <td data-label="Date">${h.appointment_date}</td>
                    <td data-label="Shift">${h.shift}</td>
                    <td data-label="Token">#${h.token_number}</td>
                    <td data-label="Status">${statusBadge(h.status)}</td>
                    <td data-label="Payment">${h.payment_status}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        document.getElementById('listCard').style.display = 'none';
        document.getElementById('historyPanel').style.display = 'block';
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

document.getElementById('tableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    showHistory(btn.dataset.id);
});

document.getElementById('closeHistoryBtn').addEventListener('click', () => {
    document.getElementById('historyPanel').style.display = 'none';
    document.getElementById('listCard').style.display = 'block';
});

document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(loadPatients, 300);
});

// Deep-link from the global search dropdown (?search=9198...).
const urlSearch = new URLSearchParams(window.location.search).get('search') || '';
if (urlSearch) document.getElementById('searchInput').value = urlSearch;
loadPatients();
