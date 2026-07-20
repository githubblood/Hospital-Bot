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
    document.getElementById('hMorningStart').value = (h.morning_start || '09:00:00').slice(0, 5);
    document.getElementById('hMorningEnd').value = (h.morning_end || '13:00:00').slice(0, 5);
    document.getElementById('hEveningStart').value = (h.evening_start || '17:00:00').slice(0, 5);
    document.getElementById('hEveningEnd').value = (h.evening_end || '20:00:00').slice(0, 5);
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
        emergency_contact: document.getElementById('hEmergencyContact').value.trim(),
        morning_start: document.getElementById('hMorningStart').value,
        morning_end: document.getElementById('hMorningEnd').value,
        evening_start: document.getElementById('hEveningStart').value,
        evening_end: document.getElementById('hEveningEnd').value
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
    const role = document.getElementById('aRole').value;
    const currentPassword = document.getElementById('aCurrentPassword').value;
    const newPassword = document.getElementById('aNewPassword').value;
    if (!name) { showFeedback('account', 'Name is required.', true); return; }

    try {
        const res = await AdminAuth.authFetch('/api/admin/settings/account', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, role, current_password: currentPassword, new_password: newPassword || undefined })
        });
        const data = await res.json();
        if (!res.ok) { showFeedback('account', data.error || 'Could not save', true); return; }

        showFeedback('account', 'Account updated.', false);
        document.getElementById('aCurrentPassword').value = '';
        document.getElementById('aNewPassword').value = '';

        // Keep the JWT's cached name/role in sync so the sidebar reflects the
        // change immediately, not just after the next login.
        const admin = AdminAuth.getAdmin();
        if (admin) { admin.name = name; admin.role = role; AdminAuth.setSession(AdminAuth.getToken(), admin); }
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

loadHospital();
loadFeatures();
loadAccount();
loadWhatsApp();
