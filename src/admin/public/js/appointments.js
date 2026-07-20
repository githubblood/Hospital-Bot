// Auth guard, sidebar user block, logout, search, and activity are all
// wired centrally by topbar.js (loaded before this file).

function statusBadge(status) {
    return `<span class="badge badge-${status.toLowerCase()}">${status}</span>`;
}

// Rescheduled rows link to whichever appointment replaced/preceded them
// (rescheduled_from/rescheduled_to — see schema.sql) so staff can trace the
// history instead of seeing two disconnected rows.
function statusCell(appt) {
    let html = statusBadge(appt.status);
    if (appt.rescheduled_to) html += `<br><small>→ New #${appt.rescheduled_to}</small>`;
    if (appt.rescheduled_from) html += `<br><small>← From #${appt.rescheduled_from}</small>`;
    return html;
}

// Real reminder state from schedulerService's 15-minute scan (reminder_sent /
// reminder_sent_at) — not a fabricated status; appointments the scan hasn't
// reached yet (outside its 2-hour window, or already past) show "Pending".
function reminderCell(appt) {
    if (!appt.reminder_sent) return `<span class="badge badge-pending">Pending</span>`;
    const sentAt = appt.reminder_sent_at ? new Date(appt.reminder_sent_at).toLocaleString() : '';
    return `<span class="badge badge-confirmed">Sent</span>${sentAt ? `<br><small>${sentAt}</small>` : ''}`;
}

async function loadDoctorFilter() {
    try {
        const res = await AdminAuth.authFetch('/api/admin/doctors');
        const data = await res.json();
        const select = document.getElementById('filterDoctor');
        data.doctors.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = `Dr. ${d.name}${d.is_on_leave ? ' (on leave)' : ''}`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('Failed to load doctors for filter:', err);
    }
}

function actionButtons(appt) {
    const buttons = [];
    if (appt.status === 'Pending') {
        buttons.push(`<button class="action-btn action-approve" data-action="approve" data-id="${appt.id}">Approve</button>`);
        buttons.push(`<button class="action-btn action-reject" data-action="reject" data-id="${appt.id}">Reject</button>`);
    } else if (appt.status !== 'Cancelled' && appt.status !== 'Completed' && appt.status !== 'Rescheduled') {
        buttons.push(`<button class="action-btn action-cancel" data-action="cancel" data-id="${appt.id}">Cancel</button>`);
    }
    // Delete is separate from Cancel — Cancel is the patient-facing outcome
    // (notifies them, keeps the record); Delete permanently removes the row,
    // for clearing out old/test clutter rather than managing a real booking.
    // Only offered on already-Cancelled rows — matches the server-side guard
    // in appointmentAdminService.deleteAppointment, not just a hidden button.
    if (appt.status === 'Cancelled') {
        buttons.push(`<button class="action-btn action-delete" data-action="delete" data-id="${appt.id}">Delete</button>`);
    }
    return buttons.join('');
}

async function loadAppointments() {
    const date = document.getElementById('filterDate').value;
    const status = document.getElementById('filterStatus').value;
    const doctorId = document.getElementById('filterDoctor').value;

    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (status) params.set('status', status);
    if (doctorId) params.set('doctorId', doctorId);

    try {
        const res = await AdminAuth.authFetch('/api/admin/appointments?' + params.toString());
        const data = await res.json();

        const tbody = document.getElementById('tableBody');
        const emptyState = document.getElementById('emptyState');
        tbody.innerHTML = '';

        if (data.appointments.length === 0) {
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
            data.appointments.forEach(a => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td data-label="Patient">${escapeHtml(a.patient_name)}<br><small>${escapeHtml(a.phone_number)}</small></td>
                    <td data-label="Doctor">Dr. ${escapeHtml(a.doctor_name)}</td>
                    <td data-label="Date">${a.appointment_date}</td>
                    <td data-label="Shift">${a.shift}</td>
                    <td data-label="Token">#${a.token_number}</td>
                    <td data-label="Status">${statusCell(a)}</td>
                    <td data-label="Payment">${a.payment_status}</td>
                    <td data-label="Reminder">${reminderCell(a)}</td>
                    <td data-label="Actions">${actionButtons(a)}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        console.error('Failed to load appointments:', err);
    }
}

async function handleAction(action, id) {
    let reason = null;
    if (action === 'reject' || action === 'cancel') {
        reason = window.prompt(`Reason for ${action === 'reject' ? 'rejecting' : 'cancelling'} this appointment (optional):`) || null;
    } else if (!window.confirm('Approve this appointment?')) {
        return;
    }

    try {
        const res = await AdminAuth.authFetch(`/api/admin/appointments/${id}/${action}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Action failed');
            return;
        }
        loadAppointments();
    } catch (err) {
        console.error('Action failed:', err);
    }
}

async function handleDelete(id) {
    if (!window.confirm('Permanently delete this appointment record? This cannot be undone.')) return;

    try {
        const res = await AdminAuth.authFetch(`/api/admin/appointments/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Could not delete appointment');
            return;
        }
        loadAppointments();
    } catch (err) {
        console.error('Delete failed:', err);
    }
}

document.getElementById('tableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'delete') { handleDelete(btn.dataset.id); return; }
    handleAction(btn.dataset.action, btn.dataset.id);
});

document.getElementById('clearCancelledBtn').addEventListener('click', async () => {
    if (!window.confirm('Permanently delete ALL cancelled appointments? This cannot be undone.')) return;

    try {
        const res = await AdminAuth.authFetch('/api/admin/appointments/cancelled', { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Could not clear cancelled appointments');
            return;
        }
        alert(`Deleted ${data.deletedCount} cancelled appointment(s).`);
        loadAppointments();
    } catch (err) {
        console.error('Clear cancelled failed:', err);
    }
});

document.getElementById('filterDate').addEventListener('change', loadAppointments);
document.getElementById('filterStatus').addEventListener('change', loadAppointments);
document.getElementById('filterDoctor').addEventListener('change', loadAppointments);
document.getElementById('clearFilters').addEventListener('click', () => {
    document.getElementById('filterDate').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterDoctor').value = '';
    loadAppointments();
});

loadDoctorFilter();
loadAppointments();
