PlatformAuth.requireAuth();

function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

async function loadStats() {
    try {
        const res = await PlatformAuth.authFetch('/api/platform/dashboard/stats');
        const data = await res.json();

        document.getElementById('statTotalHospitals').textContent = data.hospitals.total;
        document.getElementById('statActiveHospitals').textContent = data.hospitals.active;
        document.getElementById('statSuspendedHospitals').textContent = data.hospitals.suspended;
        document.getElementById('statPendingSetup').textContent = data.hospitals.pendingSetup;
        document.getElementById('statDoctors').textContent = data.totalDoctors;
        document.getElementById('statStaff').textContent = data.totalStaff;
        document.getElementById('statPatients').textContent = data.totalPatients;
        document.getElementById('statTodayAppointments').textContent = data.todayAppointments;
        document.getElementById('statMonthAppointments').textContent = data.monthAppointments;
        document.getElementById('statWhatsApp').textContent = data.activeWhatsAppConnections;

        document.getElementById('healthDatabase').textContent = data.systemHealth.database;
        document.getElementById('healthUptime').textContent = formatUptime(data.systemHealth.serverUptimeSeconds);
        document.getElementById('healthWhatsAppSetup').textContent = data.systemHealth.hospitalsNeedingWhatsAppSetup;
        document.getElementById('healthNoDoctors').textContent = data.systemHealth.hospitalsWithNoDoctors;

        document.getElementById('healthWhatsAppSetupItem').classList.toggle('warn', data.systemHealth.hospitalsNeedingWhatsAppSetup > 0);
        document.getElementById('healthNoDoctorsItem').classList.toggle('warn', data.systemHealth.hospitalsWithNoDoctors > 0);
    } catch (err) {
        console.error('Failed to load platform dashboard stats:', err);
    }
}

const ACTIVITY_ICON = {
    HospitalCreated: { cls: 'created', glyph: '+' },
    HospitalEdited: { cls: 'edited', glyph: '✎' },
    HospitalSuspended: { cls: 'suspended', glyph: '⛔' },
    HospitalActivated: { cls: 'activated', glyph: '✓' },
    HospitalAdminLogin: { cls: 'login', glyph: '→' },
    PlatformLogin: { cls: 'login', glyph: '→' }
};
const ACTIVITY_LABEL = {
    HospitalCreated: h => `${h.actor_name} created ${h.hospital_name}`,
    HospitalEdited: h => `${h.actor_name} edited ${h.hospital_name}`,
    HospitalSuspended: h => `${h.actor_name} suspended ${h.hospital_name}`,
    HospitalActivated: h => `${h.actor_name} activated ${h.hospital_name}`,
    HospitalAdminLogin: h => `${h.actor_name} logged in to ${h.hospital_name}`,
    PlatformLogin: h => `${h.actor_name} logged in to the platform panel`
};

function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function loadActivity() {
    try {
        const res = await PlatformAuth.authFetch('/api/platform/audit-log?limit=8');
        const data = await res.json();
        const list = document.getElementById('activityList');
        const empty = document.getElementById('activityEmpty');
        list.innerHTML = '';
        empty.style.display = data.entries.length === 0 ? 'block' : 'none';

        data.entries.forEach(entry => {
            const icon = ACTIVITY_ICON[entry.action_type] || { cls: 'edited', glyph: '•' };
            const labelFn = ACTIVITY_LABEL[entry.action_type];
            const li = document.createElement('li');
            li.className = 'activity-item';
            li.innerHTML = `
                <div class="activity-icon ${icon.cls}">${icon.glyph}</div>
                <div class="activity-body">
                    <div class="who">${escapeHtml(labelFn ? labelFn(entry) : entry.action_type)}</div>
                    <div class="ts">${timeAgo(entry.created_at)}</div>
                </div>
            `;
            list.appendChild(li);
        });
    } catch (err) {
        console.error('Failed to load activity feed:', err);
    }
}

loadStats();
loadActivity();
