// ---- Tabs ----
document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    });
});

function showFeedback(id, message, isError) {
    const errorEl = document.getElementById(id + 'Error');
    const successEl = document.getElementById(id + 'Success');
    if (errorEl) errorEl.textContent = isError ? message : '';
    if (successEl) successEl.textContent = isError ? '' : message;
    if (!isError && successEl) setTimeout(() => { successEl.textContent = ''; }, 3000);
}

// ---- Hospital Info ----
async function loadHospital() {
    const res = await AdminAuth.authFetch('/api/admin/settings/hospital');
    const h = await res.json();
    document.getElementById('hName').value = h.name || '';
    document.getElementById('hIcon').value = h.icon || '🏥';
    document.getElementById('hAddress').value = h.address || '';
    document.getElementById('hCity').value = h.city || '';
    document.getElementById('hState').value = h.state || '';
    document.getElementById('hCountry').value = h.country || '';
    document.getElementById('hPincode').value = h.pincode || '';
    document.getElementById('hPhone').value = h.phone || '';
    document.getElementById('hEmail').value = h.email || '';
    document.getElementById('hWebsite').value = h.website || '';
    document.getElementById('hEmergencyContact').value = h.emergency_contact || '';
}

document.getElementById('saveHospitalBtn').addEventListener('click', async () => {
    const body = {
        name: document.getElementById('hName').value.trim(),
        icon: document.getElementById('hIcon').value.trim(),
        address: document.getElementById('hAddress').value.trim(),
        city: document.getElementById('hCity').value.trim(),
        state: document.getElementById('hState').value.trim(),
        country: document.getElementById('hCountry').value.trim(),
        pincode: document.getElementById('hPincode').value.trim(),
        phone: document.getElementById('hPhone').value.trim(),
        email: document.getElementById('hEmail').value.trim(),
        website: document.getElementById('hWebsite').value.trim(),
        emergency_contact: document.getElementById('hEmergencyContact').value.trim()
    };
    try {
        const res = await AdminAuth.authFetch('/api/admin/settings/hospital', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { showFeedback('hospital', data.error || 'Could not save', true); return; }
        showFeedback('hospital', 'Saved.', false);

        // Keep the cached admin_info in sync so a future page load (or this
        // one, via the direct DOM update below) shows the new name — topbar.js
        // reads hospital_name from a copy captured at its own load time, so
        // just re-calling its render functions here wouldn't pick this up.
        const admin = AdminAuth.getAdmin();
        if (admin) {
            admin.hospital_name = body.name;
            AdminAuth.setSession(AdminAuth.getToken(), admin);
        }
        document.querySelectorAll('.brand-name').forEach(el => { el.textContent = body.name; });
        renderSidebarUser();
    } catch (err) { showFeedback('hospital', 'Could not reach the server.', true); }
});

// ---- Features ----
const FEATURES = [
    { key: 'multi_branch', name: 'Multi Branch', desc: 'Hospital has multiple branches/locations.' },
    { key: 'multi_dept', name: 'Multi Department', desc: 'Multiple departments (Cardiology, Ortho, etc.).' },
    { key: 'multi_doctor', name: 'Multi Doctor', desc: 'Patients can choose between multiple doctors.' },
    { key: 'walk_in_only', name: 'Walk-in Only', desc: 'No appointment booking — walk-ins only.' },
    { key: 'approval_required', name: 'Approval Required', desc: 'Bookings need reception approval before confirming.' },
    { key: 'payment_required', name: 'Payment Required', desc: 'Patients must pay before a booking is confirmed.' },
    { key: 'emergency_support', name: 'Emergency Support', desc: 'Bot responds immediately to emergency keywords.' }
];
let featureState = {};

function renderFeatures() {
    const list = document.getElementById('featureList');
    list.innerHTML = FEATURES.map(f => `
        <div class="feature-row">
            <div>
                <div class="name">${f.name}</div>
                <div class="desc">${f.desc}</div>
            </div>
            <div class="theme-switch ${featureState[f.key] ? 'on' : ''}" data-feature="${f.key}">
                <div class="theme-knob"></div>
            </div>
        </div>
    `).join('');
    list.querySelectorAll('[data-feature]').forEach(el => {
        el.addEventListener('click', () => {
            const key = el.dataset.feature;
            featureState[key] = !featureState[key];
            el.classList.toggle('on', featureState[key]);
        });
    });
}

async function loadFeatures() {
    const res = await AdminAuth.authFetch('/api/admin/settings/features');
    featureState = await res.json();
    renderFeatures();
}

document.getElementById('saveFeaturesBtn').addEventListener('click', async () => {
    try {
        const res = await AdminAuth.authFetch('/api/admin/settings/features', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(featureState)
        });
        const data = await res.json();
        if (!res.ok) { showFeedback('features', data.error || 'Could not save', true); return; }
        showFeedback('features', 'Saved — takes effect on the bot\'s next message.', false);
    } catch (err) { showFeedback('features', 'Could not reach the server.', true); }
});

// ---- Account ----
async function loadAccount() {
    const res = await AdminAuth.authFetch('/api/admin/settings/account');
    const a = await res.json();
    document.getElementById('aName').value = a.name || '';
    document.getElementById('aEmail').value = a.email || '';
    document.getElementById('aRole').value = a.role || 'Hospital Administrator';
}

document.getElementById('saveAccountBtn').addEventListener('click', async () => {
    const name = document.getElementById('aName').value.trim();
    const currentPassword = document.getElementById('aCurrentPassword').value;
    const newPassword = document.getElementById('aNewPassword').value;
    if (!name) { showFeedback('account', 'Name is required.', true); return; }

    try {
        const res = await AdminAuth.authFetch('/api/admin/settings/account', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, current_password: currentPassword, new_password: newPassword || undefined })
        });
        const data = await res.json();
        if (!res.ok) { showFeedback('account', data.error || 'Could not save', true); return; }

        showFeedback('account', 'Account updated.', false);
        document.getElementById('aCurrentPassword').value = '';
        document.getElementById('aNewPassword').value = '';

        // Keep the JWT's cached name in sync so the sidebar reflects the
        // change immediately, not just after the next login. role isn't
        // editable here (see staff.html), so it's left untouched.
        const admin = AdminAuth.getAdmin();
        if (admin) { admin.name = name; AdminAuth.setSession(AdminAuth.getToken(), admin); }
        renderSidebarUser();
    } catch (err) { showFeedback('account', 'Could not reach the server.', true); }
});

// ---- WhatsApp ----
async function loadWhatsApp() {
    const res = await AdminAuth.authFetch('/api/admin/settings/whatsapp');
    const w = await res.json();
    document.getElementById('wPhoneId').value = w.whatsapp_business_phone_id || '';
    document.getElementById('wToken').value = w.whatsapp_access_token || '';
}

document.getElementById('saveWhatsAppBtn').addEventListener('click', async () => {
    const body = {
        whatsapp_business_phone_id: document.getElementById('wPhoneId').value.trim(),
        whatsapp_access_token: document.getElementById('wToken').value.trim()
    };
    try {
        const res = await AdminAuth.authFetch('/api/admin/settings/whatsapp', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { showFeedback('whatsapp', data.error || 'Could not save', true); return; }
        showFeedback('whatsapp', 'Saved.', false);
    } catch (err) { showFeedback('whatsapp', 'Could not reach the server.', true); }
});

document.getElementById('testWhatsAppBtn').addEventListener('click', async () => {
    const resultEl = document.getElementById('whatsappTestResult');
    resultEl.className = 'test-result ok';
    resultEl.style.display = 'block';
    resultEl.textContent = 'Testing…';
    try {
        const res = await AdminAuth.authFetch('/api/admin/settings/whatsapp/test', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            resultEl.className = 'test-result ok';
            resultEl.textContent = `Connected — sending as ${data.displayPhoneNumber || 'this number'}.`;
        } else {
            resultEl.className = 'test-result fail';
            resultEl.textContent = data.message || 'Connection failed.';
        }
    } catch (err) {
        resultEl.className = 'test-result fail';
        resultEl.textContent = 'Could not reach the server.';
    }
});

// ---- Operating Hours ----
const HOUR_FIELD_IDS = {
    morning_start: 'ohMorningStart', morning_end: 'ohMorningEnd',
    afternoon_start: 'ohAfternoonStart', afternoon_end: 'ohAfternoonEnd',
    evening_start: 'ohEveningStart', evening_end: 'ohEveningEnd'
};
const HOUR_DEFAULTS = {
    morning_start: '09:00:00', morning_end: '13:00:00',
    afternoon_start: '13:00:00', afternoon_end: '17:00:00',
    evening_start: '17:00:00', evening_end: '20:00:00'
};

async function loadOperatingHours() {
    const res = await AdminAuth.authFetch('/api/admin/settings/operating-hours');
    const h = await res.json();
    Object.entries(HOUR_FIELD_IDS).forEach(([field, id]) => {
        document.getElementById(id).value = (h[field] || HOUR_DEFAULTS[field]).slice(0, 5);
    });
}

function readHoursForm() {
    const body = {};
    Object.entries(HOUR_FIELD_IDS).forEach(([field, id]) => {
        body[field] = document.getElementById(id).value;
    });
    return body;
}

// Hand-built 4-button modal (Keep / Reschedule / Cancel / Abort) — distinct
// from Confirm.show, which is strictly binary. Resolves the clicked action,
// or 'abort' on Escape/backdrop-click, matching Confirm's safe-cancel default.
function showAffectedAppointmentsDialog(preview) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show';

        const box = document.createElement('div');
        box.className = 'modal-box modal-wide';

        const h3 = document.createElement('h3');
        h3.textContent = '⚠️ Appointments Affected';

        const p = document.createElement('p');
        p.textContent = `${preview.totalCount} upcoming appointment${preview.totalCount === 1 ? '' : 's'} fall outside the new operating hours.`;

        const listWrap = document.createElement('div');
        listWrap.style.maxHeight = '220px';
        listWrap.style.overflowY = 'auto';
        listWrap.style.marginBottom = '1rem';
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        thead.innerHTML = '<tr><th>Patient</th><th>Doctor</th><th>Date</th><th>Shift</th><th>Time</th></tr>';
        const tbody = document.createElement('tbody');
        ['Morning', 'Afternoon', 'Evening'].forEach(shift => {
            (preview.byShift[shift] || []).forEach(a => {
                const tr = document.createElement('tr');
                [a.patient_name, 'Dr. ' + a.doctor_name, a.appointment_date, a.shift, a.expected_time].forEach(text => {
                    const td = document.createElement('td');
                    td.textContent = text;
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
        });
        table.appendChild(thead);
        table.appendChild(tbody);
        listWrap.appendChild(table);

        const actions = document.createElement('div');
        actions.className = 'modal-actions';
        const buttons = [
            { action: 'abort', label: 'Cancel Changes', cls: 'btn-outline' },
            { action: 'keep', label: 'Keep Existing Appointments', cls: 'btn-outline' },
            { action: 'reschedule', label: 'Reschedule Affected Appointments', cls: 'btn-primary' },
            { action: 'cancel', label: 'Cancel Affected Appointments', cls: 'btn-danger' }
        ];
        buttons.forEach(({ action, label, cls }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn ' + cls;
            btn.textContent = label;
            btn.addEventListener('click', () => cleanup(action));
            actions.appendChild(btn);
        });

        box.appendChild(h3);
        box.appendChild(p);
        box.appendChild(listWrap);
        box.appendChild(actions);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function cleanup(action) {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(action);
        }
        function onKey(e) { if (e.key === 'Escape') cleanup('abort'); }
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup('abort'); });
        document.addEventListener('keydown', onKey);
    });
}

document.getElementById('saveHoursBtn').addEventListener('click', async () => {
    const hours = readHoursForm();
    try {
        const previewRes = await AdminAuth.authFetch('/api/admin/settings/operating-hours/preview', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(hours)
        });
        const preview = await previewRes.json();
        if (!previewRes.ok) { showFeedback('hours', preview.error || 'Could not check affected appointments', true); return; }

        const action = preview.totalCount === 0 ? 'keep' : await showAffectedAppointmentsDialog(preview);
        if (!action || action === 'abort') return;

        const res = await AdminAuth.authFetch('/api/admin/settings/operating-hours', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...hours, action })
        });
        const data = await res.json();
        if (!res.ok) { showFeedback('hours', data.error || 'Could not save', true); return; }

        const affectedNote = data.affectedCount > 0 ? ` (${data.affectedCount} appointment(s): ${action}).` : '.';
        showFeedback('hours', 'Operating hours saved' + affectedNote, false);
        Toast.show('Operating hours saved.', 'success');
    } catch (err) { showFeedback('hours', 'Could not reach the server.', true); }
});

// ---- Emergency Override ----
const OVERRIDE_REASONS = ['Doctor Emergency', 'Hospital Emergency', 'Public Holiday', 'Maintenance', 'Power Failure', 'Other'];

function openOverrideForm(scope) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    const box = document.createElement('div');
    box.className = 'modal-box';

    const h3 = document.createElement('h3');
    h3.textContent = scope === 'Hospital' ? '🚨 Close Entire Hospital' : `🚨 Close ${scope} Shift`;

    const reasonGroup = document.createElement('div');
    reasonGroup.className = 'form-group';
    const reasonLabel = document.createElement('label');
    reasonLabel.textContent = 'Reason';
    const reasonSelect = document.createElement('select');
    OVERRIDE_REASONS.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r; opt.textContent = r;
        reasonSelect.appendChild(opt);
    });
    reasonGroup.appendChild(reasonLabel);
    reasonGroup.appendChild(reasonSelect);

    const noteGroup = document.createElement('div');
    noteGroup.className = 'form-group';
    const noteLabel = document.createElement('label');
    noteLabel.textContent = 'Note (optional)';
    const noteInput = document.createElement('textarea');
    noteInput.rows = 2;
    noteGroup.appendChild(noteLabel);
    noteGroup.appendChild(noteInput);

    const errorEl = document.createElement('div');
    errorEl.className = 'error-text';

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'btn btn-outline'; cancelBtn.textContent = 'Cancel';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button'; confirmBtn.className = 'btn btn-danger'; confirmBtn.textContent = 'Close ' + (scope === 'Hospital' ? 'Hospital' : scope);
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);

    box.appendChild(h3);
    box.appendChild(reasonGroup);
    box.appendChild(noteGroup);
    box.appendChild(errorEl);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Closing…';
        try {
            const res = await AdminAuth.authFetch('/api/admin/schedule-overrides', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scope, reason: reasonSelect.value, note: noteInput.value.trim() || undefined })
            });
            const data = await res.json();
            if (!res.ok) { errorEl.textContent = data.error || 'Could not create override'; confirmBtn.disabled = false; confirmBtn.textContent = 'Close ' + (scope === 'Hospital' ? 'Hospital' : scope); return; }
            close();
            Toast.show(`${scope === 'Hospital' ? 'Hospital' : scope + ' shift'} closed.${data.affectedCount ? ` ${data.affectedCount} appointment(s) handled.` : ''}`, 'success');
            loadActiveOverrides();
            loadWaitingList();
        } catch (err) {
            errorEl.textContent = 'Could not reach the server.';
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Close ' + (scope === 'Hospital' ? 'Hospital' : scope);
        }
    });
}

const OVERRIDE_SCOPES = ['Morning', 'Afternoon', 'Evening', 'Hospital'];
const scopeLabel = (s) => s === 'Hospital' ? 'Entire Hospital' : `${s} Shift`;

async function loadActiveOverrides() {
    const res = await AdminAuth.authFetch('/api/admin/schedule-overrides');
    const data = await res.json();
    const byScope = {};
    data.overrides.forEach(o => { byScope[o.scope] = o; });
    const hospitalOverride = byScope['Hospital'];

    const grid = document.getElementById('overrideScopeGrid');
    grid.innerHTML = OVERRIDE_SCOPES.map(scope => {
        const active = byScope[scope];
        // A shift is "covered" when Hospital-wide is closed but this
        // particular shift isn't independently closed itself — its own
        // toggle is disabled since Hospital already blocks it regardless.
        const coveredByHospital = scope !== 'Hospital' && hospitalOverride && !active;

        if (active) {
            return `
                <div class="override-scope-card">
                    <div class="name">${scopeLabel(scope)}</div>
                    <span class="badge badge-cancelled">Closed</span>
                    <div class="meta">
                        <div><b>Reason:</b> ${escapeHtml(active.reason)}${active.note ? ` — ${escapeHtml(active.note)}` : ''}</div>
                        <div><b>Since:</b> ${active.start_date}</div>
                        <div><b>Closed By:</b> ${escapeHtml(active.created_by_name)}</div>
                    </div>
                    <button type="button" class="btn btn-outline" data-open-scope="${scope}" data-override-id="${active.id}">Open ${scopeLabel(scope)}</button>
                </div>`;
        }
        if (coveredByHospital) {
            return `
                <div class="override-scope-card is-covered">
                    <div class="name">${scopeLabel(scope)}</div>
                    <span class="badge badge-pending">Closed (Hospital-wide)</span>
                    <div class="meta">Covered by the hospital-wide closure — reopen the whole hospital to restore this shift's own toggle.</div>
                    <button type="button" class="btn btn-outline" disabled>Open ${scopeLabel(scope)}</button>
                </div>`;
        }
        return `
            <div class="override-scope-card">
                <div class="name">${scopeLabel(scope)}</div>
                <span class="badge badge-confirmed">Open</span>
                <button type="button" class="btn ${scope === 'Hospital' ? 'btn-danger' : 'btn-outline'}" data-close-scope="${scope}">Close ${scopeLabel(scope)}</button>
            </div>`;
    }).join('');
}

document.getElementById('overrideScopeGrid').addEventListener('click', async (e) => {
    const closeBtn = e.target.closest('[data-close-scope]');
    if (closeBtn) { openOverrideForm(closeBtn.dataset.closeScope); return; }

    const openBtn = e.target.closest('[data-open-scope]');
    if (!openBtn) return;
    const scope = openBtn.dataset.openScope;
    const ok = await Confirm.show(`Reopen ${scopeLabel(scope)}? Bookings will resume immediately, and any patients still waiting for a slot because of this closure will be notified.`, {
        title: `Open ${scopeLabel(scope)}`, confirmText: 'Open'
    });
    if (!ok) return;
    openBtn.disabled = true;
    const res = await AdminAuth.authFetch(`/api/admin/schedule-overrides/${openBtn.dataset.overrideId}/lift`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) { Toast.show(data.error || 'Could not reopen', 'error'); openBtn.disabled = false; return; }
    const admin = AdminAuth.getAdmin();
    Toast.show(
        `${scopeLabel(scope)} reopened by ${admin ? admin.name : 'you'}.${data.waitlistCleared ? ` ${data.waitlistCleared} waitlisted patient(s) rebooked.` : ''}`,
        'success'
    );
    loadActiveOverrides();
    loadWaitingList();
});

async function loadWaitingList() {
    const res = await AdminAuth.authFetch('/api/admin/waiting-list');
    const data = await res.json();
    const tbody = document.getElementById('waitlistTableBody');
    const emptyState = document.getElementById('waitlistEmptyState');
    tbody.innerHTML = '';

    if (data.entries.length === 0) {
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    data.entries.forEach(w => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(w.patient_name)}<br><small>${escapeHtml(w.phone_number)}</small></td>
            <td>Dr. ${escapeHtml(w.doctor_name)}</td>
            <td>${escapeHtml(w.department_name)}</td>
            <td>${w.preferred_date}</td>
            <td>${w.shift}</td>
            <td>${new Date(w.created_at).toLocaleString()}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ---- Audit Log ----
function auditDetails(entry) {
    if (entry.change_type === 'OperatingHours') {
        const prev = entry.previous_hours, upd = entry.updated_hours;
        if (!prev || !upd) return '—';
        const parts = ['morning', 'afternoon', 'evening'].filter(s =>
            prev[`${s}_start`] !== upd[`${s}_start`] || prev[`${s}_end`] !== upd[`${s}_end`]
        );
        return parts.length ? `Changed: ${parts.join(', ')}` : 'No shift times changed';
    }
    const scope = entry.override_scope ? (entry.override_scope === 'Hospital' ? 'Entire Hospital' : `${entry.override_scope} Shift`) : null;
    const verb = entry.change_type === 'EmergencyOverrideCreated' ? 'Closed' : 'Reopened';
    if (!scope) return entry.change_type === 'EmergencyOverrideCreated' ? 'Override created' : 'Override lifted';
    // Plain text only — the caller (loadAuditLog) already wraps this whole
    // return value in escapeHtml() before inserting it.
    return `${verb}: ${scope}${entry.override_reason ? ` — ${entry.override_reason}` : ''}`;
}

async function loadAuditLog() {
    const res = await AdminAuth.authFetch('/api/admin/schedule-audit-log');
    const data = await res.json();
    const tbody = document.getElementById('auditTableBody');
    const emptyState = document.getElementById('auditEmptyState');
    tbody.innerHTML = '';

    if (data.entries.length === 0) {
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    data.entries.forEach(entry => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(entry.created_at).toLocaleString()}</td>
            <td>${escapeHtml(entry.admin_name)}</td>
            <td>${entry.change_type}</td>
            <td>${escapeHtml(auditDetails(entry))}</td>
            <td>${entry.affected_appointments_count}</td>
            <td>${entry.action_taken}</td>
        `;
        tbody.appendChild(tr);
    });
}

loadHospital();
loadFeatures();
loadAccount();
loadWhatsApp();
loadOperatingHours();
loadActiveOverrides();
loadWaitingList();
loadAuditLog();
