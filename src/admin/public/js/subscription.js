const STATUS_LABEL_CLASS = {
    'Trial': 'status-trial',
    'Grace Period': 'status-grace-period',
    'Active': 'status-active',
    'Expired': 'status-expired',
    'Suspended': 'status-suspended',
    'No Plan Assigned': 'status-no-plan-assigned'
};

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

// Display-only day count (not a booking/gating decision) — both sides parsed
// the same way so the local timezone can't shift the answer by a day.
function daysRemaining(dateStr) {
    if (!dateStr) return null;
    const end = new Date(dateStr + 'T00:00:00Z');
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    return Math.round((end - todayUTC) / 86400000);
}

function fillBadge(status) {
    const badge = document.getElementById('subStatusBadge');
    badge.textContent = status;
    badge.className = `badge sub-status-badge ${STATUS_LABEL_CLASS[status] || 'status-no-plan-assigned'}`;
}

function infoItem(label, value) {
    return `<div class="sub-info-item"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
}

function renderInfoGrid(data) {
    const grid = document.getElementById('subInfoGrid');
    const items = [];
    items.push(infoItem('Status', data.effectiveStatus));

    if (data.effectiveStatus === 'Trial') {
        items.push(infoItem('Trial Ends', data.trialEndDate || '—'));
        const d = daysRemaining(data.trialEndDate);
        items.push(infoItem('Remaining Trial Days', d === null ? '—' : Math.max(0, d)));
    } else if (data.effectiveStatus === 'Grace Period') {
        items.push(infoItem('Grace Period Ends', data.gracePeriodEnd || '—'));
        const d = daysRemaining(data.gracePeriodEnd);
        items.push(infoItem('Remaining Grace Days', d === null ? '—' : Math.max(0, d)));
    } else if (data.effectiveStatus === 'Active') {
        items.push(infoItem('Subscription Ends', data.subscriptionEnd || 'No end date (unlimited)'));
    } else if (data.effectiveStatus === 'Expired') {
        items.push(infoItem('Expired On', data.subscriptionEnd || data.trialEndDate || '—'));
    }

    grid.innerHTML = items.join('');
}

function usageBarClass(percentUsed) {
    if (percentUsed === null) return '';
    if (percentUsed >= 90) return 'danger';
    if (percentUsed >= 70) return 'warn';
    return '';
}

function renderUsage(usage) {
    const body = document.getElementById('subUsageBody');
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
            <div class="usage-row-head">
                <span class="name">Monthly WhatsApp Conversations</span>
            </div>
            <div class="usage-not-tracked">Usage tracking for this limit isn't available yet — contact your platform administrator for details.</div>
        </div>`;
}

function renderModules(plan) {
    const grid = document.getElementById('subModuleGrid');
    const emptyNote = document.getElementById('subModuleEmptyNote');
    if (!plan) {
        grid.innerHTML = '';
        emptyNote.style.display = 'block';
        return;
    }
    emptyNote.style.display = 'none';
    grid.innerHTML = MODULE_ROWS.map(({ key, label }) => {
        const on = !!plan[key];
        return `
            <div class="module-chip">
                <span>${escapeHtml(label)}</span>
                <span class="tag ${on ? 'on' : 'off'}">${on ? 'Enabled' : 'Disabled'}</span>
            </div>`;
    }).join('');
}

async function loadSubscription() {
    try {
        const res = await AdminAuth.authFetch('/api/admin/subscription');
        const data = await res.json();
        if (!res.ok) {
            document.getElementById('subPlanName').textContent = 'Unable to load subscription';
            return;
        }

        document.getElementById('subPlanName').textContent = data.plan ? data.plan.name : 'No Plan Assigned';
        fillBadge(data.effectiveStatus);
        renderInfoGrid(data);

        const emptyNote = document.getElementById('subEmptyNote');
        if (!data.plan) {
            emptyNote.textContent = 'No plan has been assigned to your hospital yet. All limits are currently unrestricted. Contact your platform administrator to have a plan assigned.';
            emptyNote.style.display = 'block';
        } else {
            emptyNote.style.display = 'none';
        }

        renderUsage(data.usage);
        renderModules(data.plan);
    } catch (err) {
        document.getElementById('subPlanName').textContent = 'Could not reach the server';
    }
}

loadSubscription();
