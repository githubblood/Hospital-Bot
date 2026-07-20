// All doctors' queues for a chosen date (default today) — a hospital-wide
// operational view, distinct from the dashboard's single-doctor Live Queue
// widget. "Recall Token" and "Skip Token" from the original ask are
// deliberately not here: only "mark current done" exists as a real queue
// operation in this backend (see queueAdminService.markCurrentDone) — adding
// buttons for operations with nothing behind them would be decorative.

function cleanDoctorNameClient(name) {
    return String(name || '').replace(/^\s*dr\.?\s+/i, '').trim();
}

function badge(cls, text) { return `<span class="qm-badge ${cls}">${text}</span>`; }

function renderQueueRows(queues) {
    const tbody = document.getElementById('qmTableBody');
    const emptyState = document.getElementById('qmEmptyState');
    tbody.innerHTML = '';

    if (queues.length === 0) {
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    queues.forEach(q => {
        const tr = document.createElement('tr');
        const currentCell = q.current_token != null
            ? badge('serving', `#${q.current_token} Serving Now`)
            : badge('empty', 'None');
        const nextCell = q.next_token != null ? badge('next', `#${q.next_token}`) : badge('empty', '—');
        const canCallNext = q.current_appointment_id != null;

        tr.innerHTML = `
            <td data-label="Doctor">Dr. ${escapeHtml(cleanDoctorNameClient(q.doctor_name))}</td>
            <td data-label="Department">${escapeHtml(q.department_name)}</td>
            <td data-label="Shift">${escapeHtml(q.shift)}</td>
            <td data-label="Current Serving">${currentCell}</td>
            <td data-label="Next Token">${nextCell}</td>
            <td data-label="Waiting">${badge('waiting', q.patients_waiting)}</td>
            <td data-label="Completed">${q.completed_count}</td>
            <td data-label="Cancelled">${q.cancelled_count}</td>
            <td data-label="Est. Wait">${q.patients_waiting > 0 ? '~' + q.estimated_wait_mins + ' min' : '—'}</td>
            <td data-label="Actions">
                <button class="qm-action-btn" data-call-next="${q.current_appointment_id}" ${canCallNext ? '' : 'disabled'}>
                    ✅ Call Next
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function loadAllQueues() {
    const date = document.getElementById('qmDate').value;
    try {
        const res = await AdminAuth.authFetch(`/api/admin/queue/all?date=${date}`);
        const { queues } = await res.json();
        renderQueueRows(queues);
        document.getElementById('qmLastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (err) {
        console.error('Failed to load queues:', err);
    }
}

document.getElementById('qmTableBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-call-next]');
    if (!btn || btn.disabled) return;
    const appointmentId = btn.dataset.callNext;

    btn.disabled = true;
    try {
        const res = await AdminAuth.authFetch('/api/admin/queue/next', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appointment_id: appointmentId })
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Could not advance queue'); btn.disabled = false; return; }
        await loadAllQueues();
    } catch (err) {
        console.error('Call-next failed:', err);
        btn.disabled = false;
    }
});

document.getElementById('qmDate').addEventListener('change', loadAllQueues);
document.getElementById('qmRefreshBtn').addEventListener('click', loadAllQueues);

// Today's date, local components (not toISOString(), which shifts a day in IST).
const today = new Date();
document.getElementById('qmDate').value =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

loadAllQueues();
// Lightweight poll — this page has no SSE stream of its own (that's per
// doctor/shift, not "all doctors at once"); 15s keeps staff-facing data fresh
// without needing a new broadcast fan-out for every doctor/shift combination.
setInterval(loadAllQueues, 15000);
