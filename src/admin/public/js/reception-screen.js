// Reception/lobby TV display — large font, fullscreen, auto-updating via the
// same SSE queue/stream endpoint the dashboard's Live Queue widget uses (see
// adminQueueController.streamQueue). No sidebar/topbar chrome: this page is
// meant to run unattended on a monitor, not be navigated like the rest of
// the admin panel.
AdminAuth.requireAuth();

let rsEventSource = null;

function cleanDoctorNameClient(name) {
    return String(name || '').replace(/^\s*dr\.?\s+/i, '').trim();
}

async function loadSetupData() {
    try {
        const [doctorsRes, hospitalRes] = await Promise.all([
            AdminAuth.authFetch('/api/admin/doctors'),
            AdminAuth.authFetch('/api/admin/settings/hospital')
        ]);
        const { doctors } = await doctorsRes.json();
        const hospital = await hospitalRes.json();

        const select = document.getElementById('rsDoctorSelect');
        doctors.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = `Dr. ${cleanDoctorNameClient(d.name)}${d.is_on_leave ? ' (on leave)' : ''}`;
            opt.dataset.name = d.name;
            opt.dataset.dept = d.department_name || '';
            select.appendChild(opt);
        });

        document.getElementById('rsHospitalName').textContent = hospital.name || 'Hospital';
        document.getElementById('rsHospitalIcon').textContent = hospital.icon || '🏥';
    } catch (err) {
        console.error('Failed to load reception display setup data:', err);
    }
}

function startDisplay() {
    const select = document.getElementById('rsDoctorSelect');
    const doctorId = select.value;
    const shift = document.getElementById('rsShiftSelect').value;
    if (!doctorId) { alert('Select a doctor first.'); return; }

    const opt = select.selectedOptions[0];
    document.getElementById('rsDoctorName').textContent = `Dr. ${cleanDoctorNameClient(opt.dataset.name)}`;
    document.getElementById('rsDeptName').textContent = `${opt.dataset.dept} · ${shift}`;

    document.getElementById('rsSetup').style.display = 'none';
    document.getElementById('rsScreen').classList.add('active');
    document.getElementById('rsExitBtn').style.display = 'block';

    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => { /* user can retry manually; not fatal */ });
    }

    if (rsEventSource) rsEventSource.close();
    const url = `/api/admin/queue/stream?doctor_id=${doctorId}&shift=${shift}&token=${encodeURIComponent(AdminAuth.getToken())}`;
    rsEventSource = new EventSource(url);
    rsEventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        document.getElementById('rsCurrentToken').textContent = data.current_token ?? '—';
        document.getElementById('rsNextToken').textContent = data.next_token ?? '—';
        document.getElementById('rsWaiting').textContent = data.remaining_count ?? 0;
    };
}

function exitDisplay() {
    if (rsEventSource) { rsEventSource.close(); rsEventSource = null; }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.getElementById('rsScreen').classList.remove('active');
    document.getElementById('rsExitBtn').style.display = 'none';
    document.getElementById('rsSetup').style.display = 'block';
}

document.getElementById('rsStartBtn').addEventListener('click', startDisplay);
document.getElementById('rsExitBtn').addEventListener('click', exitDisplay);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') exitDisplay(); });

loadSetupData();
