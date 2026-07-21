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

let doctorsCache = [];

async function loadDoctorFilter() {
    try {
        const res = await AdminAuth.authFetch('/api/admin/doctors');
        const data = await res.json();
        doctorsCache = data.doctors;
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

const NON_TERMINAL_STATUSES = ['Pending', 'Confirmed', 'Pending_Payment', 'Waitlisted'];

function actionButtons(appt) {
    const buttons = [];
    if (appt.status === 'Pending') {
        buttons.push(`<button class="action-btn action-approve" data-action="approve" data-id="${appt.id}">Approve</button>`);
        buttons.push(`<button class="action-btn action-reject" data-action="reject" data-id="${appt.id}">Reject</button>`);
    } else if (appt.status !== 'Cancelled' && appt.status !== 'Completed' && appt.status !== 'Rescheduled') {
        buttons.push(`<button class="action-btn action-cancel" data-action="cancel" data-id="${appt.id}">Cancel</button>`);
    }
    if (NON_TERMINAL_STATUSES.includes(appt.status)) {
        buttons.push(`<button class="action-btn action-reschedule" data-action="reschedule" data-id="${appt.id}" data-doctor-id="${appt.doctor_id}">Reschedule</button>`);
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
        reason = await Confirm.prompt(`Reason for ${action === 'reject' ? 'rejecting' : 'cancelling'} this appointment (optional):`, {
            title: action === 'reject' ? 'Reject Appointment' : 'Cancel Appointment', confirmText: 'Continue'
        });
    } else {
        const ok = await Confirm.show('Approve this appointment?', { title: 'Approve Appointment', confirmText: 'Approve' });
        if (!ok) return;
    }

    try {
        const res = await AdminAuth.authFetch(`/api/admin/appointments/${id}/${action}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });
        const data = await res.json();
        if (!res.ok) {
            Toast.show(data.error || 'Action failed', 'error');
            return;
        }
        Toast.show('Appointment updated.', 'success');
        loadAppointments();
    } catch (err) {
        console.error('Action failed:', err);
    }
}

async function handleDelete(id) {
    const ok = await Confirm.show('Permanently delete this appointment record? This cannot be undone.', {
        title: 'Delete Appointment', confirmText: 'Delete', danger: true
    });
    if (!ok) return;

    try {
        const res = await AdminAuth.authFetch(`/api/admin/appointments/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
            Toast.show(data.error || 'Could not delete appointment', 'error');
            return;
        }
        Toast.show('Appointment deleted.', 'success');
        loadAppointments();
    } catch (err) {
        console.error('Delete failed:', err);
    }
}

document.getElementById('tableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'delete') { handleDelete(btn.dataset.id); return; }
    if (btn.dataset.action === 'reschedule') { openRescheduleModal(btn.dataset.id, btn.dataset.doctorId); return; }
    handleAction(btn.dataset.action, btn.dataset.id);
});

// ---- Manual reschedule (receptionist-triggered) ----
const rescheduleModal = document.getElementById('rescheduleModal');
let rescheduleAppointmentId = null;

function closeRescheduleModal() {
    rescheduleModal.classList.remove('show');
    document.getElementById('rescheduleError').textContent = '';
    rescheduleAppointmentId = null;
}

async function loadRescheduleShifts() {
    const doctorId = document.getElementById('rsDoctor').value;
    const date = document.getElementById('rsDate').value;
    const shiftSelect = document.getElementById('rsShift');
    if (!doctorId || !date) {
        shiftSelect.innerHTML = '<option value="">Pick a doctor and date first…</option>';
        return;
    }
    shiftSelect.innerHTML = '<option value="">Loading…</option>';
    try {
        const res = await AdminAuth.authFetch(`/api/admin/doctors/${doctorId}/availability?date=${date}`);
        const data = await res.json();
        const open = (data.shifts || []).filter(s => s.remaining > 0);
        if (open.length === 0) {
            shiftSelect.innerHTML = '<option value="">No open shifts on this date</option>';
            return;
        }
        shiftSelect.innerHTML = open.map(s => `<option value="${s.shift}">${s.shift} (${s.remaining} left)</option>`).join('');
    } catch (err) {
        shiftSelect.innerHTML = '<option value="">Could not load shifts</option>';
    }
}

function openRescheduleModal(appointmentId, doctorId) {
    rescheduleAppointmentId = appointmentId;
    const doctorSelect = document.getElementById('rsDoctor');
    doctorSelect.innerHTML = doctorsCache.map(d =>
        `<option value="${d.id}">Dr. ${escapeHtml(d.name)}${d.is_on_leave ? ' (on leave)' : ''}</option>`
    ).join('');
    if (doctorId) doctorSelect.value = doctorId;

    const dateInput = document.getElementById('rsDate');
    const today = new Date();
    dateInput.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    dateInput.value = '';
    document.getElementById('rsShift').innerHTML = '<option value="">Pick a date first…</option>';
    document.getElementById('rescheduleError').textContent = '';

    rescheduleModal.classList.add('show');
}

document.getElementById('rsDoctor').addEventListener('change', loadRescheduleShifts);
document.getElementById('rsDate').addEventListener('change', loadRescheduleShifts);
document.getElementById('rescheduleCancelBtn').addEventListener('click', closeRescheduleModal);
rescheduleModal.addEventListener('click', (e) => { if (e.target === rescheduleModal) closeRescheduleModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && rescheduleModal.classList.contains('show')) closeRescheduleModal(); });

document.getElementById('rescheduleConfirmBtn').addEventListener('click', async () => {
    const doctorId = document.getElementById('rsDoctor').value;
    const date = document.getElementById('rsDate').value;
    const shift = document.getElementById('rsShift').value;
    const errorEl = document.getElementById('rescheduleError');
    if (!doctorId || !date || !shift) {
        errorEl.textContent = 'Doctor, date, and shift are all required.';
        return;
    }
    try {
        const res = await AdminAuth.authFetch(`/api/admin/appointments/${rescheduleAppointmentId}/reschedule`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ doctorId: Number(doctorId), date, shift })
        });
        const data = await res.json();
        if (!res.ok) {
            errorEl.textContent = data.error || 'Could not reschedule';
            return;
        }
        closeRescheduleModal();
        Toast.show('Appointment rescheduled.', 'success');
        loadAppointments();
    } catch (err) {
        errorEl.textContent = 'Could not reach the server.';
    }
});

document.getElementById('clearCancelledBtn').addEventListener('click', async () => {
    const ok = await Confirm.show('Permanently delete ALL cancelled appointments? This cannot be undone.', {
        title: 'Clear Cancelled Appointments', confirmText: 'Delete All', danger: true
    });
    if (!ok) return;

    try {
        const res = await AdminAuth.authFetch('/api/admin/appointments/cancelled', { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
            Toast.show(data.error || 'Could not clear cancelled appointments', 'error');
            return;
        }
        Toast.show(`Deleted ${data.deletedCount} cancelled appointment(s).`, 'success');
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

// Deep-link from the dashboard's per-day charts (?date=YYYY-MM-DD, optional
// &status=) — clicking a day there jumps here pre-filtered to it.
const urlParams = new URLSearchParams(window.location.search);
const urlDate = urlParams.get('date') || '';
const urlStatus = urlParams.get('status') || '';
if (urlDate) document.getElementById('filterDate').value = urlDate;
if (urlStatus) document.getElementById('filterStatus').value = urlStatus;

loadDoctorFilter();
loadAppointments();
