// Auth guard, sidebar user block, logout, search, and activity are all
// wired centrally by topbar.js (loaded before this file).

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
const SHIFTS = ['morning', 'afternoon', 'evening'];
const SHIFT_LABELS = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
// Same-every-working-day Booking Capacity model (admin-controlled, per the
// feature spec) — no per-weekday customization, just which days the doctor
// works plus one shared shift template.
const SHIFT_DEFAULTS = {
    morning: { start: '09:00', end: '13:00', max: 25 },
    afternoon: { start: '14:00', end: '17:00', max: 20 },
    evening: { start: '18:00', end: '20:00', max: 15 }
};

let editingId = null; // null = add mode, otherwise the doctor id being edited

function buildWorkingDaysRow() {
    const row = document.getElementById('workingDaysRow');
    row.innerHTML = DAYS.map(day => `
        <label class="wd-check">
            <input type="checkbox" id="wd_${day}">
            <span>${DAY_LABELS[day]}</span>
        </label>
    `).join('');
}

function buildShiftCards() {
    const grid = document.getElementById('shiftCardGrid');
    grid.innerHTML = SHIFTS.map(shift => {
        const d = SHIFT_DEFAULTS[shift];
        return `
        <div class="shift-card">
            <div class="shift-card-header">
                <label class="shift-toggle">
                    <input type="checkbox" id="sh_${shift}_on">
                    <span>${SHIFT_LABELS[shift]}</span>
                </label>
            </div>
            <div class="shift-card-body">
                <div class="form-group">
                    <label>Start Time</label>
                    <input type="time" id="sh_${shift}_start" value="${d.start}">
                </div>
                <div class="form-group">
                    <label>End Time</label>
                    <input type="time" id="sh_${shift}_end" value="${d.end}">
                </div>
                <div class="form-group">
                    <label>Maximum Patients</label>
                    <input type="number" id="sh_${shift}_max" min="1" value="${d.max}">
                </div>
            </div>
        </div>`;
    }).join('');
}

// Add-mode defaults: Mon-Sat, Morning only — editable before saving.
function resetCapacityForm() {
    DAYS.forEach(day => { document.getElementById(`wd_${day}`).checked = day !== 'sunday'; });
    SHIFTS.forEach(shift => {
        const d = SHIFT_DEFAULTS[shift];
        document.getElementById(`sh_${shift}_on`).checked = shift === 'morning';
        document.getElementById(`sh_${shift}_start`).value = d.start;
        document.getElementById(`sh_${shift}_end`).value = d.end;
        document.getElementById(`sh_${shift}_max`).value = d.max;
    });
    document.getElementById('fDuration').value = '15';
    document.getElementById('fAvailability').value = 'available';
}

function capacityFormToSchedule() {
    const working_days = DAYS.filter(day => document.getElementById(`wd_${day}`).checked);
    const shifts = {};
    SHIFTS.forEach(shift => {
        if (document.getElementById(`sh_${shift}_on`).checked) {
            shifts[shift] = {
                start: document.getElementById(`sh_${shift}_start`).value,
                end: document.getElementById(`sh_${shift}_end`).value,
                // Deliberately NOT `|| 1` — that silently substituted 1 for
                // ANY blank/unparseable input (NaN), before the validation
                // loop below ever got a chance to see it, so an accidentally
                // cleared field saved as "1 patient max" with zero warning
                // instead of being rejected. Leaving it NaN here lets
                // Number.isInteger(cfg.max_tokens) in the loop below catch
                // it and show a real error instead.
                max_tokens: parseInt(document.getElementById(`sh_${shift}_max`).value, 10)
            };
        }
    });
    return {
        working_days,
        duration_mins: parseInt(document.getElementById('fDuration').value, 10),
        shifts
    };
}

function scheduleToCapacityForm(schedule) {
    resetCapacityForm();
    const workingDays = schedule.working_days || [];
    DAYS.forEach(day => { document.getElementById(`wd_${day}`).checked = workingDays.includes(day); });

    SHIFTS.forEach(shift => {
        const cfg = (schedule.shifts || {})[shift];
        document.getElementById(`sh_${shift}_on`).checked = !!cfg;
        if (cfg) {
            document.getElementById(`sh_${shift}_start`).value = cfg.start;
            document.getElementById(`sh_${shift}_end`).value = cfg.end;
            document.getElementById(`sh_${shift}_max`).value = cfg.max_tokens;
        }
    });
    if (schedule.duration_mins) document.getElementById('fDuration').value = String(schedule.duration_mins);
}

async function loadDepartments() {
    const res = await AdminAuth.authFetch('/api/admin/departments');
    const data = await res.json();
    const select = document.getElementById('fDepartment');
    select.innerHTML = '';
    data.departments.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        select.appendChild(opt);
    });
}

function showForm(mode, doctor) {
    editingId = mode === 'edit' ? doctor.id : null;
    document.getElementById('formTitle').textContent = mode === 'edit' ? `Edit Dr. ${doctor.name}` : 'Add Doctor';
    document.getElementById('formError').textContent = '';
    resetCapacityForm();

    if (mode === 'edit') {
        document.getElementById('fName').value = doctor.name;
        document.getElementById('fDepartment').value = doctor.department_id;
        document.getElementById('fFee').value = doctor.consultation_fee;
        scheduleToCapacityForm(doctor.schedule_json);
        document.getElementById('fAvailability').value = doctor.is_on_leave ? 'unavailable' : 'available';
    } else {
        document.getElementById('doctorForm').reset();
        resetCapacityForm();
    }

    document.getElementById('formPanel').style.display = 'block';
    document.getElementById('formPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideForm() {
    document.getElementById('formPanel').style.display = 'none';
    editingId = null;
}

document.getElementById('addDoctorBtn').addEventListener('click', () => showForm('add'));
document.getElementById('cancelFormBtn').addEventListener('click', hideForm);

document.getElementById('doctorForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorText = document.getElementById('formError');
    errorText.textContent = '';

    const schedule = capacityFormToSchedule();
    if (schedule.working_days.length === 0) {
        errorText.textContent = 'Select at least one working day.';
        return;
    }
    if (Object.keys(schedule.shifts).length === 0) {
        errorText.textContent = 'Enable at least one shift (Morning/Afternoon/Evening).';
        return;
    }
    for (const [shiftName, cfg] of Object.entries(schedule.shifts)) {
        if (cfg.end <= cfg.start) {
            errorText.textContent = `${shiftName} shift's end time must be after its start time.`;
            return;
        }
        if (!Number.isInteger(cfg.max_tokens) || cfg.max_tokens <= 0) {
            errorText.textContent = `${shiftName} shift's maximum patients must be a whole number greater than 0.`;
            return;
        }
        const windowMinutes = (() => {
            const [sh, sm] = cfg.start.split(':').map(Number);
            const [eh, em] = cfg.end.split(':').map(Number);
            return (eh * 60 + em) - (sh * 60 + sm);
        })();
        if (cfg.max_tokens * schedule.duration_mins > windowMinutes) {
            errorText.textContent = `${shiftName} shift can't fit ${cfg.max_tokens} patients at ${schedule.duration_mins} min each in that time window.`;
            return;
        }
    }

    const body = {
        name: document.getElementById('fName').value.trim(),
        department_id: Number(document.getElementById('fDepartment').value),
        consultation_fee: Number(document.getElementById('fFee').value),
        schedule_json: schedule,
        is_on_leave: document.getElementById('fAvailability').value === 'unavailable'
    };

    const url = editingId ? `/api/admin/doctors/${editingId}` : '/api/admin/doctors';
    const method = editingId ? 'PUT' : 'POST';

    try {
        const res = await AdminAuth.authFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) {
            errorText.textContent = data.error || 'Failed to save doctor';
            return;
        }
        hideForm();
        loadDoctors(document.getElementById('doctorSearch').value.trim());
    } catch (err) {
        errorText.textContent = 'Could not reach the server.';
    }
});

let doctorsCache = [];

function renderCards(doctors) {
    const grid = document.getElementById('doctorGrid');
    const emptyState = document.getElementById('emptyState');
    grid.innerHTML = '';

    if (doctors.length === 0) {
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    doctors.forEach(d => {
        const card = document.createElement('div');
        card.className = 'doctor-card';
        const statusHtml = d.is_on_leave
            ? '<span class="status-pill leave"><span class="status-dot"></span>On Leave</span>'
            : '<span class="status-pill available"><span class="status-dot"></span>Available</span>';

        card.innerHTML = `
            <div class="doctor-card-top">
                ${Avatar.html(d.name)}
                <div>
                    <div class="doctor-card-name">Dr. ${escapeHtml(d.name)}</div>
                    <div class="doctor-card-dept">${escapeHtml(d.department_name)}</div>
                    ${statusHtml}
                </div>
            </div>
            <div class="doctor-stats-row">
                <div class="doctor-stat"><div class="num">${d.patient_count}</div><div class="lbl">Patients</div></div>
                <div class="doctor-stat"><div class="num">${d.appointment_count}</div><div class="lbl">Appointments</div></div>
                <div class="doctor-stat"><div class="num">₹${Math.round(d.consultation_fee)}</div><div class="lbl">Fee</div></div>
            </div>
            <div class="doctor-card-actions">
                <button class="btn-edit" data-action="edit" data-id="${d.id}">Edit</button>
                <button class="btn-leave" data-action="leave" data-id="${d.id}">${d.is_on_leave ? 'Mark Active' : 'Mark Leave'}</button>
                <button class="btn-delete" data-action="delete" data-id="${d.id}">Delete</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function updateStats(doctors) {
    const total = doctors.length;
    const onLeave = doctors.filter(d => d.is_on_leave).length;
    document.getElementById('statTotal').textContent = total;
    document.getElementById('statAvailable').textContent = total - onLeave;
    document.getElementById('statLeave').textContent = onLeave;
    document.getElementById('doctorCountSub').textContent = `${total} doctor${total === 1 ? '' : 's'} in total`;
}

async function loadDoctors(search) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    const res = await AdminAuth.authFetch('/api/admin/doctors?' + params.toString());
    const data = await res.json();
    doctorsCache = data.doctors;
    updateStats(doctorsCache);
    renderCards(doctorsCache);
}

document.getElementById('doctorGrid').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === 'edit') {
        const doctor = doctorsCache.find(d => String(d.id) === id);
        if (doctor) showForm('edit', doctor);
        return;
    }

    if (action === 'leave') {
        await AdminAuth.authFetch(`/api/admin/doctors/${id}/leave`, { method: 'PATCH' });
        loadDoctors(document.getElementById('doctorSearch').value.trim());
        return;
    }

    if (action === 'delete') {
        if (!window.confirm('Delete this doctor? This cannot be undone.')) return;
        const res = await AdminAuth.authFetch(`/api/admin/doctors/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Could not delete doctor');
            return;
        }
        loadDoctors(document.getElementById('doctorSearch').value.trim());
    }
});

let searchDebounce = null;
document.getElementById('doctorSearch').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => loadDoctors(e.target.value.trim()), 300);
});

buildWorkingDaysRow();
buildShiftCards();
loadDepartments();

// Deep-link from the global search dropdown (?search=Name).
const urlSearch = new URLSearchParams(window.location.search).get('search') || '';
if (urlSearch) document.getElementById('doctorSearch').value = urlSearch;
loadDoctors(urlSearch);
