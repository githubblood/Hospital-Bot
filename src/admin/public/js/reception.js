// Auth guard, sidebar user block, logout, search, and activity are all
// wired centrally by topbar.js (loaded before this file).

let doctorsCache = [];
let appointmentsCache = [];
let searchDebounce = null;
let patientSearchDebounce = null;
let bookingMode = 'existing'; // 'existing' | 'new'
let bookingIsWalkIn = false;
let selectedPatient = null; // { id, name, phone_number, uhid }
let rescheduleAppointmentId = null;

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Doctors (shared by filter dropdown + booking modal) ----
async function loadDoctors() {
    const res = await AdminAuth.authFetch('/api/admin/doctors');
    const data = await res.json();
    doctorsCache = data.doctors || [];

    const filterSelect = document.getElementById('rcDoctorFilter');
    filterSelect.innerHTML = '<option value="">All Doctors</option>' +
        doctorsCache.map(d => `<option value="${d.id}">Dr. ${escapeHtml(d.name)}</option>`).join('');
}

// ---- Dashboard stats ----
async function loadDashboard() {
    const dateFilter = document.getElementById('rcDateFilter').value;
    const params = new URLSearchParams();
    if (dateFilter) params.set('date', dateFilter === 'today' ? todayStr() : dateFilter);
    try {
        const res = await AdminAuth.authFetch('/api/admin/reception/dashboard?' + params.toString());
        const data = await res.json();
        if (!res.ok) return;
        document.getElementById('statTotal').textContent = data.total;
        document.getElementById('statWaiting').textContent = data.waiting;
        document.getElementById('statCheckedIn').textContent = data.checkedIn;
        document.getElementById('statInConsultation').textContent = data.inConsultation;
        document.getElementById('statCompleted').textContent = data.completed;
        document.getElementById('statCancelled').textContent = data.cancelled;
        document.getElementById('statNoShow').textContent = data.noShow;
        document.getElementById('statWalkIn').textContent = data.walkIn;
    } catch (err) {
        console.error('Failed to load dashboard stats:', err);
    }
}

// ---- Appointment table ----
function statusPillHtml(status) {
    const map = {
        Confirmed: 'confirmed', Pending: 'pending', Pending_Payment: 'pending',
        Completed: 'completed', Cancelled: 'cancelled', 'No Show': 'noshow'
    };
    const cls = map[status] || 'other';
    return `<span class="status-pill ${cls}">${escapeHtml(status)}</span>`;
}

function checkinPillHtml(status) {
    const cls = status === 'Waiting' ? 'waiting' : status === 'Checked In' ? 'checked-in' : 'in-consultation';
    return `<span class="checkin-pill ${cls}">${escapeHtml(status)}</span>`;
}

function actionsForAppointment(appt) {
    const btns = [`<button class="action-btn ghost" data-action="timeline" data-id="${appt.id}">Timeline</button>`];

    if (appt.status === 'Confirmed') {
        if (appt.checkin_status === 'Waiting') {
            btns.unshift(`<button class="action-btn" data-action="check-in" data-id="${appt.id}">Check In</button>`);
            btns.push(`<button class="action-btn outline" data-action="no-show" data-id="${appt.id}">No Show</button>`);
            btns.push(`<button class="action-btn" data-action="reschedule" data-id="${appt.id}" data-doctor-id="${appt.doctor_id}">Reschedule</button>`);
            btns.push(`<button class="action-btn danger" data-action="cancel" data-id="${appt.id}">Cancel</button>`);
        } else if (appt.checkin_status === 'Checked In') {
            btns.unshift(`<button class="action-btn" data-action="start-consultation" data-id="${appt.id}">Start Consultation</button>`);
            btns.push(`<button class="action-btn" data-action="reschedule" data-id="${appt.id}" data-doctor-id="${appt.doctor_id}">Reschedule</button>`);
            btns.push(`<button class="action-btn danger" data-action="cancel" data-id="${appt.id}">Cancel</button>`);
        } else if (appt.checkin_status === 'In Consultation') {
            btns.unshift(`<button class="action-btn" data-action="complete" data-id="${appt.id}">Complete</button>`);
        }
    }
    return btns.join('');
}

function renderRows(appts) {
    const tbody = document.getElementById('tableBody');
    const emptyState = document.getElementById('emptyState');
    tbody.innerHTML = '';

    if (appts.length === 0) {
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    appts.forEach(a => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Token">#${a.token_number}</td>
            <td data-label="Patient">${escapeHtml(a.patient_name)}</td>
            <td data-label="UHID">${escapeHtml(a.patient_uhid || '—')}</td>
            <td data-label="Phone">${escapeHtml(a.phone_number)}</td>
            <td data-label="Doctor">Dr. ${escapeHtml(a.doctor_name)}</td>
            <td data-label="Date">${escapeHtml(a.appointment_date)}</td>
            <td data-label="Shift">${escapeHtml(a.shift)}</td>
            <td data-label="Status">${statusPillHtml(a.status)}</td>
            <td data-label="Check-in">${checkinPillHtml(a.checkin_status)}</td>
            <td data-label="Source">${escapeHtml(a.booking_source)}</td>
            <td data-label="Actions"><div class="actions-cell">${actionsForAppointment(a)}</div></td>
        `;
        tbody.appendChild(tr);
    });
}

function showLoading() {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('rcTable').style.display = 'none';
    document.getElementById('emptyState').style.display = 'none';
}
function showError(message) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorStateText').textContent = message;
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('rcTable').style.display = 'none';
    document.getElementById('emptyState').style.display = 'none';
}
function showLoaded() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('rcTable').style.display = '';
}

async function loadAppointments() {
    const search = document.getElementById('rcSearch').value.trim();
    const dateFilter = document.getElementById('rcDateFilter').value;
    const status = document.getElementById('rcStatusFilter').value;
    const doctorId = document.getElementById('rcDoctorFilter').value;

    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (dateFilter) params.set('date', dateFilter === 'today' ? todayStr() : dateFilter);
    if (status) params.set('status', status);
    if (doctorId) params.set('doctorId', doctorId);

    showLoading();
    try {
        const res = await AdminAuth.authFetch('/api/admin/reception/appointments?' + params.toString());
        const data = await res.json();
        if (!res.ok) { showError(data.error || 'Could not load appointments. Please try again.'); return; }
        showLoaded();
        appointmentsCache = data.appointments;
        renderRows(appointmentsCache);
    } catch (err) {
        showError('Could not reach the server. Please try again.');
    }
}

function refreshAll() {
    loadDashboard();
    loadAppointments();
}

document.getElementById('retryLoadBtn').addEventListener('click', loadAppointments);
document.getElementById('rcSearch').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(loadAppointments, 300);
});
document.getElementById('rcDateFilter').addEventListener('change', refreshAll);
document.getElementById('rcStatusFilter').addEventListener('change', loadAppointments);
document.getElementById('rcDoctorFilter').addEventListener('change', loadAppointments);

// ---- Row actions ----
document.getElementById('tableBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === 'timeline') { openTimeline(id); return; }
    if (action === 'reschedule') { openRescheduleModal(id, btn.dataset.doctorId); return; }

    if (action === 'check-in') {
        const res = await AdminAuth.authFetch(`/api/admin/reception/appointments/${id}/check-in`, { method: 'PATCH' });
        const data = await res.json();
        if (!res.ok) { Toast.show(data.error || 'Could not check in', 'error'); return; }
        Toast.show('Patient checked in.', 'success');
        refreshAll();
        return;
    }
    if (action === 'start-consultation') {
        const res = await AdminAuth.authFetch(`/api/admin/reception/appointments/${id}/start-consultation`, { method: 'PATCH' });
        const data = await res.json();
        if (!res.ok) { Toast.show(data.error || 'Could not start consultation', 'error'); return; }
        Toast.show('Consultation started.', 'success');
        refreshAll();
        return;
    }
    if (action === 'complete') {
        const res = await AdminAuth.authFetch(`/api/admin/reception/appointments/${id}/complete`, { method: 'PATCH' });
        const data = await res.json();
        if (!res.ok) { Toast.show(data.error || 'Could not complete', 'error'); return; }
        Toast.show('Appointment completed.', 'success');
        refreshAll();
        return;
    }
    if (action === 'no-show') {
        const ok = await Confirm.show('Mark this appointment as No Show?', { title: 'No Show', confirmText: 'Mark No Show', danger: true });
        if (!ok) return;
        const res = await AdminAuth.authFetch(`/api/admin/reception/appointments/${id}/no-show`, { method: 'PATCH' });
        const data = await res.json();
        if (!res.ok) { Toast.show(data.error || 'Could not mark No Show', 'error'); return; }
        Toast.show('Marked as No Show.', 'success');
        refreshAll();
        return;
    }
    if (action === 'cancel') {
        const reason = await Confirm.prompt('Reason for cancelling this appointment (optional):', {
            title: 'Cancel Appointment', confirmText: 'Cancel Appointment', placeholder: 'e.g. Patient requested by phone'
        });
        if (reason === null) return;
        const res = await AdminAuth.authFetch(`/api/admin/appointments/${id}/cancel`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason || undefined })
        });
        const data = await res.json();
        if (!res.ok) { Toast.show(data.error || 'Could not cancel appointment', 'error'); return; }
        Toast.show('Appointment cancelled.', 'success');
        refreshAll();
    }
});

// ---- Timeline modal ----
function timelineIcon() { return '<span class="timeline-dot"></span>'; }

async function openTimeline(appointmentId) {
    const list = document.getElementById('timelineList');
    const empty = document.getElementById('timelineEmpty');
    list.innerHTML = '';
    empty.style.display = 'none';
    document.getElementById('timelineModal').classList.add('show');

    try {
        const res = await AdminAuth.authFetch(`/api/admin/reception/appointments/${appointmentId}/timeline`);
        const data = await res.json();
        if (!res.ok || !data.timeline || data.timeline.length === 0) {
            empty.style.display = 'block';
            return;
        }
        data.timeline.forEach(entry => {
            const li = document.createElement('li');
            li.className = 'timeline-item';
            const who = entry.changed_by_name ? escapeHtml(entry.changed_by_name) : 'Patient / WhatsApp';
            const from = entry.from_status ? `${escapeHtml(entry.from_status)} → ` : '';
            li.innerHTML = `${timelineIcon()}<div><div>${from}<strong>${escapeHtml(entry.to_status)}</strong> — ${who}</div><div class="ts">${new Date(entry.changed_at).toLocaleString()}</div></div>`;
            list.appendChild(li);
        });
    } catch (err) {
        empty.textContent = 'Could not load timeline.';
        empty.style.display = 'block';
    }
}
document.getElementById('timelineCloseBtn').addEventListener('click', () => document.getElementById('timelineModal').classList.remove('show'));
document.getElementById('timelineModal').addEventListener('click', (e) => { if (e.target === document.getElementById('timelineModal')) document.getElementById('timelineModal').classList.remove('show'); });

// ---- Reschedule modal (same pattern as appointments.js) ----
const rescheduleModal = document.getElementById('rescheduleModal');

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
    dateInput.min = todayStr();
    dateInput.value = '';
    document.getElementById('rsShift').innerHTML = '<option value="">Pick a date first…</option>';
    document.getElementById('rescheduleError').textContent = '';

    rescheduleModal.classList.add('show');
}

document.getElementById('rsDoctor').addEventListener('change', loadRescheduleShifts);
document.getElementById('rsDate').addEventListener('change', loadRescheduleShifts);
document.getElementById('rescheduleCancelBtn').addEventListener('click', closeRescheduleModal);
rescheduleModal.addEventListener('click', (e) => { if (e.target === rescheduleModal) closeRescheduleModal(); });

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
        if (!res.ok) { errorEl.textContent = data.error || 'Could not reschedule'; return; }
        closeRescheduleModal();
        Toast.show('Appointment rescheduled.', 'success');
        refreshAll();
    } catch (err) {
        errorEl.textContent = 'Could not reach the server.';
    }
});

// ---- Booking / Walk-in modal ----
const bookingModal = document.getElementById('bookingModal');

function resetBookingForm() {
    selectedPatient = null;
    document.getElementById('patientSearchInput').value = '';
    document.getElementById('patientSearchResults').classList.remove('show');
    document.getElementById('patientSearchResults').innerHTML = '';
    document.getElementById('selectedPatientChip').classList.remove('show');
    document.getElementById('npName').value = '';
    document.getElementById('npPhone').value = '';
    document.getElementById('npAge').value = '';
    document.getElementById('npGender').value = 'M';
    document.getElementById('bkShift').innerHTML = '<option value="">Pick a doctor and date first…</option>';
    document.getElementById('bookingError').textContent = '';
    setPatientMode('existing');
}

function setPatientMode(mode) {
    bookingMode = mode;
    document.getElementById('patientModeExistingBtn').classList.toggle('active', mode === 'existing');
    document.getElementById('patientModeNewBtn').classList.toggle('active', mode === 'new');
    document.getElementById('existingPatientPanel').style.display = mode === 'existing' ? 'block' : 'none';
    document.getElementById('newPatientPanel').style.display = mode === 'new' ? 'block' : 'none';
}
document.getElementById('patientModeExistingBtn').addEventListener('click', () => setPatientMode('existing'));
document.getElementById('patientModeNewBtn').addEventListener('click', () => setPatientMode('new'));

document.getElementById('patientSearchInput').addEventListener('input', (e) => {
    clearTimeout(patientSearchDebounce);
    const q = e.target.value.trim();
    const resultsEl = document.getElementById('patientSearchResults');
    if (!q) { resultsEl.classList.remove('show'); resultsEl.innerHTML = ''; return; }
    patientSearchDebounce = setTimeout(async () => {
        const res = await AdminAuth.authFetch('/api/admin/patients?search=' + encodeURIComponent(q));
        const data = await res.json();
        const patients = data.patients || [];
        if (patients.length === 0) {
            resultsEl.innerHTML = '<div class="patient-search-result-row">No matches</div>';
        } else {
            resultsEl.innerHTML = patients.map(p =>
                `<div class="patient-search-result-row" data-id="${p.id}" data-name="${escapeHtml(p.name)}" data-phone="${escapeHtml(p.phone_number)}" data-uhid="${escapeHtml(p.uhid || '')}">
                    ${escapeHtml(p.name)} · ${escapeHtml(p.phone_number)} ${p.uhid ? `· ${escapeHtml(p.uhid)}` : ''}
                </div>`
            ).join('');
        }
        resultsEl.classList.add('show');
    }, 300);
});

document.getElementById('patientSearchResults').addEventListener('click', (e) => {
    const row = e.target.closest('.patient-search-result-row[data-id]');
    if (!row) return;
    selectedPatient = { id: Number(row.dataset.id), name: row.dataset.name, phone_number: row.dataset.phone, uhid: row.dataset.uhid };
    document.getElementById('selectedPatientLabel').textContent = `${selectedPatient.name} · ${selectedPatient.phone_number}${selectedPatient.uhid ? ' · ' + selectedPatient.uhid : ''}`;
    document.getElementById('selectedPatientChip').classList.add('show');
    document.getElementById('patientSearchResults').classList.remove('show');
    document.getElementById('patientSearchInput').value = '';
});
document.getElementById('clearSelectedPatientBtn').addEventListener('click', () => {
    selectedPatient = null;
    document.getElementById('selectedPatientChip').classList.remove('show');
});

async function loadBookingShifts() {
    const doctorId = document.getElementById('bkDoctor').value;
    const date = bookingIsWalkIn ? todayStr() : document.getElementById('bkDate').value;
    const shiftSelect = document.getElementById('bkShift');
    if (!doctorId || !date) {
        shiftSelect.innerHTML = '<option value="">Pick a doctor and date first…</option>';
        return;
    }
    shiftSelect.innerHTML = '<option value="">Loading…</option>';
    try {
        const res = await AdminAuth.authFetch(`/api/admin/doctors/${doctorId}/availability?date=${date}`);
        const data = await res.json();
        const open = (data.shifts || []).filter(s => s.remaining > 0);
        shiftSelect.innerHTML = open.length === 0
            ? '<option value="">No open shifts on this date</option>'
            : open.map(s => `<option value="${s.shift}">${s.shift} (${s.remaining} left)</option>`).join('');
    } catch (err) {
        shiftSelect.innerHTML = '<option value="">Could not load shifts</option>';
    }
}
document.getElementById('bkDoctor').addEventListener('change', loadBookingShifts);
document.getElementById('bkDate').addEventListener('change', loadBookingShifts);

function openBookingModal(isWalkIn) {
    bookingIsWalkIn = isWalkIn;
    resetBookingForm();
    document.getElementById('bookingModalTitle').textContent = isWalkIn ? 'Register Walk-in' : 'Book Appointment';
    document.getElementById('bookingConfirmBtn').textContent = isWalkIn ? 'Register & Check In' : 'Save';

    const doctorSelect = document.getElementById('bkDoctor');
    doctorSelect.innerHTML = doctorsCache.map(d => `<option value="${d.id}">Dr. ${escapeHtml(d.name)}${d.is_on_leave ? ' (on leave)' : ''}</option>`).join('');

    document.getElementById('bkDateGroup').style.display = isWalkIn ? 'none' : 'block';
    document.getElementById('bkCheckInRow').style.display = isWalkIn ? 'none' : 'flex';
    document.getElementById('bkCheckInNow').checked = false;
    if (isWalkIn) {
        document.getElementById('bkDate').value = todayStr();
    } else {
        document.getElementById('bkDate').min = todayStr();
        document.getElementById('bkDate').value = '';
    }
    document.getElementById('bkShift').innerHTML = '<option value="">Pick a doctor and date first…</option>';

    bookingModal.classList.add('show');
}
document.getElementById('bookBtn').addEventListener('click', () => openBookingModal(false));
document.getElementById('walkInBtn').addEventListener('click', () => openBookingModal(true));
document.getElementById('bookingCancelBtn').addEventListener('click', () => bookingModal.classList.remove('show'));
bookingModal.addEventListener('click', (e) => { if (e.target === bookingModal) bookingModal.classList.remove('show'); });

document.getElementById('bookingConfirmBtn').addEventListener('click', async () => {
    const errorEl = document.getElementById('bookingError');
    errorEl.textContent = '';

    const doctorId = document.getElementById('bkDoctor').value;
    const shift = document.getElementById('bkShift').value;
    const date = bookingIsWalkIn ? todayStr() : document.getElementById('bkDate').value;
    if (!doctorId || !shift || (!bookingIsWalkIn && !date)) {
        errorEl.textContent = 'Doctor, date, and shift are all required.';
        return;
    }

    let body = { doctorId: Number(doctorId), shift };
    if (!bookingIsWalkIn) body.date = date;

    if (bookingMode === 'existing') {
        if (!selectedPatient) { errorEl.textContent = 'Search for and select a patient first.'; return; }
        body.patientId = selectedPatient.id;
    } else {
        const name = document.getElementById('npName').value.trim();
        const phone = document.getElementById('npPhone').value.trim();
        const age = document.getElementById('npAge').value;
        const gender = document.getElementById('npGender').value;
        if (!name || !phone || !age) { errorEl.textContent = 'Name, phone, and age are all required for a new patient.'; return; }
        body.newPatient = { name, phone, age: Number(age), gender };
    }
    if (!bookingIsWalkIn) body.checkInNow = document.getElementById('bkCheckInNow').checked;

    const url = bookingIsWalkIn ? '/api/admin/reception/walk-ins' : '/api/admin/reception/appointments';
    try {
        const res = await AdminAuth.authFetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.error || 'Could not save appointment'; return; }
        bookingModal.classList.remove('show');
        Toast.show(bookingIsWalkIn ? `Walk-in registered — Token #${data.tokenNumber}.` : `Appointment booked — Token #${data.tokenNumber}.`, 'success');
        refreshAll();
    } catch (err) {
        errorEl.textContent = 'Could not reach the server.';
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (bookingModal.classList.contains('show')) bookingModal.classList.remove('show');
    if (rescheduleModal.classList.contains('show')) closeRescheduleModal();
    if (document.getElementById('timelineModal').classList.contains('show')) document.getElementById('timelineModal').classList.remove('show');
});

// ---- Init ----
document.getElementById('rcDateFilter').value = 'today';
document.getElementById('rcDateSub').textContent = `Showing ${todayStr()}`;
loadDoctors().then(refreshAll);
