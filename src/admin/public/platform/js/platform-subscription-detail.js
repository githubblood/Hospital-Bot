PlatformAuth.requireAuth();

const hospitalId = new URLSearchParams(window.location.search).get('hospitalId');
let currentData = null;

const USAGE_ROWS = [
    { key: 'branches', label: 'Branches' },
    { key: 'departments', label: 'Departments' },
    { key: 'doctors', label: 'Doctors' },
    { key: 'staff', label: 'Staff' },
    { key: 'monthlyAppointments', label: 'Monthly Appointments' }
];
const MODULE_ROWS = [
    { key: 'reportsModule', label: 'Reports' },
    { key: 'receptionModule', label: 'Reception' },
    { key: 'analyticsModule', label: 'Analytics' },
    { key: 'apiAccess', label: 'API Access' },
    { key: 'multiBranchSupport', label: 'Multi-Branch Support' }
];
const ACTION_LABELS = {
    PlanAssigned: 'Plan Assigned', PlanChanged: 'Plan Changed', TrialExtended: 'Trial Extended',
    SubscriptionActivated: 'Subscription Activated', SubscriptionSuspended: 'Subscription Suspended',
    SubscriptionReactivated: 'Subscription Reactivated', PlanCreated: 'Plan Created',
    PlanUpdated: 'Plan Updated', PlanArchived: 'Plan Archived', PlanRestored: 'Plan Restored'
};

function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function statusClass(status) { return 'status-' + status.toLowerCase().replace(/\s+/g, '-'); }

function summarizeDetails(entry) {
    if (!entry.details) return '—';
    if ((entry.action_type === 'PlanAssigned' || entry.action_type === 'PlanChanged')) {
        return entry.details.isTrial ? 'Assigned as trial' : 'Assigned as paid subscription';
    }
    if (entry.action_type === 'TrialExtended' && entry.details.additionalDays) {
        return `+${entry.details.additionalDays} day(s), new end: ${entry.details.newTrialEndDate}`;
    }
    return '—';
}

async function loadAll() {
    if (!hospitalId) {
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('errorState').style.display = 'block';
        document.getElementById('errorState').textContent = 'No hospital id specified.';
        return;
    }
    try {
        const [detailRes, historyRes] = await Promise.all([
            PlatformAuth.authFetch(`/api/platform/subscriptions/${hospitalId}`),
            PlatformAuth.authFetch(`/api/platform/subscriptions/${hospitalId}/history`)
        ]);
        if (detailRes.status === 404) {
            document.getElementById('loadingState').style.display = 'none';
            document.getElementById('errorState').style.display = 'block';
            document.getElementById('errorState').textContent = 'Hospital not found.';
            return;
        }
        if (!detailRes.ok || !historyRes.ok) throw new Error('Request failed');

        currentData = await detailRes.json();
        const history = await historyRes.json();
        render(currentData, history.entries);

        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('detailContent').style.display = 'block';
    } catch (err) {
        console.error('Failed to load subscription detail:', err);
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('errorState').style.display = 'block';
        document.getElementById('errorState').textContent = 'Could not reach the server.';
    }
}

function render(data, historyEntries) {
    document.getElementById('hospitalName').textContent = data.hospital.name;

    const badge = document.getElementById('statusBadge');
    badge.textContent = data.effectiveStatus;
    badge.className = `badge ${statusClass(data.effectiveStatus)}`;

    const info = [];
    info.push(['Plan', data.plan ? data.plan.name : 'No Plan Assigned']);
    info.push(['Effective Status', data.effectiveStatus]);
    info.push(['Base Status', data.subscriptionStatus]);
    if (data.trialStartDate) info.push(['Trial Start', data.trialStartDate]);
    if (data.trialEndDate) info.push(['Trial End', data.trialEndDate]);
    if (data.subscriptionStart) info.push(['Subscription Start', data.subscriptionStart]);
    if (data.subscriptionEnd) info.push(['Subscription End', data.subscriptionEnd]);
    if (data.gracePeriodEnd) info.push(['Grace Period End', data.gracePeriodEnd]);
    document.getElementById('infoGrid').innerHTML = info.map(([k, v]) =>
        `<div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div>`
    ).join('');

    renderUsage(data.usage);
    renderModules(data.plan);
    renderHistory(historyEntries);

    document.getElementById('extendTrialBtn').style.display = data.subscriptionStatus === 'Trial' ? 'inline-flex' : 'none';
    document.getElementById('activateBtn').style.display = data.subscriptionStatus === 'Trial' ? 'inline-flex' : 'none';
    document.getElementById('reactivateBtn').style.display = data.subscriptionStatus === 'Suspended' ? 'inline-flex' : 'none';
    document.getElementById('suspendBtn').style.display = data.subscriptionStatus !== 'Suspended' ? 'inline-flex' : 'none';
}

function usageBarClass(percentUsed) {
    if (percentUsed === null) return '';
    if (percentUsed >= 90) return 'danger';
    if (percentUsed >= 70) return 'warn';
    return '';
}

function renderUsage(usage) {
    const body = document.getElementById('usageBody');
    body.innerHTML = USAGE_ROWS.map(({ key, label }) => {
        const u = usage[key];
        const countText = u.unlimited ? `${u.current} used · Unlimited` : `${u.current} / ${u.max} used`;
        const pct = u.unlimited ? 0 : (u.percentUsed || 0);
        return `
            <div class="usage-row">
                <div class="usage-row-head">
                    <span class="name">${escapeHtml(label)}</span>
                    <span class="count">${escapeHtml(countText)}</span>
                </div>
                <div class="usage-bar-track"><div class="usage-bar-fill ${usageBarClass(u.unlimited ? null : u.percentUsed)}" style="width:${u.unlimited ? 4 : pct}%;"></div></div>
            </div>`;
    }).join('') + `
        <div class="usage-row">
            <div class="usage-row-head"><span class="name">Monthly WhatsApp Conversations</span></div>
            <div class="usage-not-tracked">Usage tracking for this limit isn't available yet.</div>
        </div>`;
}

function renderModules(plan) {
    const grid = document.getElementById('moduleGrid');
    const emptyNote = document.getElementById('moduleEmptyNote');
    if (!plan) { grid.innerHTML = ''; emptyNote.style.display = 'block'; return; }
    emptyNote.style.display = 'none';
    grid.innerHTML = MODULE_ROWS.map(({ key, label }) => {
        const on = !!plan[key];
        return `<div class="module-chip"><span>${escapeHtml(label)}</span><span class="tag ${on ? 'on' : 'off'}">${on ? 'Enabled' : 'Disabled'}</span></div>`;
    }).join('');
}

function renderHistory(entries) {
    const tbody = document.getElementById('historyTableBody');
    const empty = document.getElementById('historyEmpty');
    tbody.innerHTML = '';
    empty.style.display = entries.length === 0 ? 'block' : 'none';
    entries.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Action">${escapeHtml(ACTION_LABELS[e.action_type] || e.action_type)}</td>
            <td data-label="Plan">${escapeHtml(e.plan_name || '—')}</td>
            <td data-label="Details">${escapeHtml(summarizeDetails(e))}</td>
            <td data-label="By">${escapeHtml(e.actor_name || '—')}</td>
            <td data-label="When">${fmtDateTime(e.created_at)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ---- Assign / Change Plan modal ----
const assignModal = document.getElementById('assignModal');
document.querySelectorAll('input[name="assignMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
        const isTrial = document.querySelector('input[name="assignMode"]:checked').value === 'trial';
        document.getElementById('trialFields').style.display = isTrial ? 'flex' : 'none';
        document.getElementById('paidFields').style.display = isTrial ? 'none' : 'flex';
    });
});

async function openAssignModal() {
    document.getElementById('assignModalError').textContent = '';
    const select = document.getElementById('fAssignPlan');
    select.innerHTML = '<option>Loading…</option>';
    assignModal.classList.add('show');

    try {
        const res = await PlatformAuth.authFetch('/api/platform/plans?status=Active&pageSize=100');
        const data = await res.json();
        select.innerHTML = data.plans.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        if (currentData && currentData.plan) select.value = currentData.plan.id;
    } catch (err) {
        select.innerHTML = '<option value="">Could not load plans</option>';
    }
}

document.getElementById('assignPlanBtn').addEventListener('click', openAssignModal);
document.getElementById('assignModalCancelBtn').addEventListener('click', () => assignModal.classList.remove('show'));
assignModal.addEventListener('click', (e) => { if (e.target === assignModal) assignModal.classList.remove('show'); });

document.getElementById('assignModalSaveBtn').addEventListener('click', async () => {
    const errorEl = document.getElementById('assignModalError');
    errorEl.textContent = '';
    const planId = document.getElementById('fAssignPlan').value;
    const isTrial = document.querySelector('input[name="assignMode"]:checked').value === 'trial';
    const body = { planId, isTrial };
    if (isTrial) body.trialDays = document.getElementById('fTrialDays').value;
    else body.subscriptionMonths = document.getElementById('fSubscriptionMonths').value;

    try {
        const res = await PlatformAuth.authFetch(`/api/platform/subscriptions/${hospitalId}/assign`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.error || 'Could not assign plan'; return; }
        assignModal.classList.remove('show');
        Toast.show('Plan assigned.', 'success');
        loadAll();
    } catch (err) {
        errorEl.textContent = 'Could not reach the server.';
    }
});

// ---- Extend Trial modal ----
const extendModal = document.getElementById('extendModal');
document.getElementById('extendTrialBtn').addEventListener('click', () => {
    document.getElementById('extendModalError').textContent = '';
    document.getElementById('fAdditionalDays').value = 7;
    extendModal.classList.add('show');
});
document.getElementById('extendModalCancelBtn').addEventListener('click', () => extendModal.classList.remove('show'));
extendModal.addEventListener('click', (e) => { if (e.target === extendModal) extendModal.classList.remove('show'); });

document.getElementById('extendModalSaveBtn').addEventListener('click', async () => {
    const errorEl = document.getElementById('extendModalError');
    errorEl.textContent = '';
    const additionalDays = document.getElementById('fAdditionalDays').value;

    try {
        const res = await PlatformAuth.authFetch(`/api/platform/subscriptions/${hospitalId}/extend-trial`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ additionalDays })
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.error || 'Could not extend trial'; return; }
        extendModal.classList.remove('show');
        Toast.show('Trial extended.', 'success');
        loadAll();
    } catch (err) {
        errorEl.textContent = 'Could not reach the server.';
    }
});

// ---- Activate / Suspend / Reactivate ----
async function runStatusAction(endpoint, confirmMessage, confirmTitle, danger, successMessage) {
    const ok = await Confirm.show(confirmMessage, { title: confirmTitle, confirmText: confirmTitle, danger });
    if (!ok) return;
    try {
        const res = await PlatformAuth.authFetch(`/api/platform/subscriptions/${hospitalId}/${endpoint}`, { method: 'PATCH' });
        const data = await res.json();
        if (!res.ok) { Toast.show(data.error || 'Action failed', 'error'); return; }
        Toast.show(successMessage, 'success');
        loadAll();
    } catch (err) {
        Toast.show('Could not reach the server.', 'error');
    }
}

document.getElementById('activateBtn').addEventListener('click', () => runStatusAction(
    'activate', 'This will mark the subscription Active immediately, ending the trial period. Continue?', 'Activate', false, 'Subscription activated.'
));
document.getElementById('suspendBtn').addEventListener('click', () => runStatusAction(
    'suspend', 'This hospital will immediately lose access to login, Reception, and WhatsApp booking. Continue?', 'Suspend', true, 'Subscription suspended.'
));
document.getElementById('reactivateBtn').addEventListener('click', () => runStatusAction(
    'reactivate', 'This will restore full access for this hospital. Continue?', 'Reactivate', false, 'Subscription reactivated.'
));

loadAll();
