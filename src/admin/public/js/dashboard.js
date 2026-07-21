// Auth guard, sidebar user block, logout, search, and activity are all
// wired centrally by topbar.js (loaded before this file).

// Weekday + short date for chart tooltips ("Mon, Jul 20") — full enough to
// read as "details for this one day" without crowding the x-axis, which
// keeps the terser MM-DD labels. Local Y/M/D construction (not
// toISOString()), same IST off-by-one fix already applied elsewhere in this
// project (see topbar.js's date chip).
function formatFullDate(isoDate) {
    return new Date(isoDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function statusBadge(status) {
    const cls = 'badge-' + status.toLowerCase();
    return `<span class="badge ${cls}">${status}</span>`;
}

async function loadStats() {
    try {
        const res = await AdminAuth.authFetch('/api/admin/stats');
        const data = await res.json();

        const tbody = document.getElementById('recentTableBody');
        const emptyState = document.getElementById('emptyState');
        tbody.innerHTML = '';

        if (data.recentAppointments.length === 0) {
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
            data.recentAppointments.forEach(a => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td data-label="Patient">${escapeHtml(a.patient_name)}<br><small>${escapeHtml(a.phone_number)}</small></td>
                    <td data-label="Doctor">Dr. ${escapeHtml(a.doctor_name)}</td>
                    <td data-label="Date">${a.appointment_date}</td>
                    <td data-label="Shift">${a.shift}</td>
                    <td data-label="Token">#${a.token_number}</td>
                    <td data-label="Status">${statusBadge(a.status)}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        // authFetch already redirects on 401; anything else, fail quietly on
        // this refresh cycle rather than breaking the whole dashboard.
        console.error('Failed to load stats:', err);
    }
}

// ---- Today overview (8 real stat cards) ----
async function loadOverview() {
    try {
        const res = await AdminAuth.authFetch('/api/admin/stats/today-overview');
        const d = await res.json();
        document.getElementById('ovTotal').textContent = d.totalToday;
        document.getElementById('ovConfirmed').textContent = d.confirmedToday;
        document.getElementById('ovCancelled').textContent = d.cancelledToday;
        document.getElementById('ovCompleted').textContent = d.completedToday;
        document.getElementById('ovWaiting').textContent = d.waitingToday;
        document.getElementById('ovAvailable').textContent = d.availableDoctorsToday;
        document.getElementById('ovOnLeave').textContent = d.doctorsOnLeave;
        document.getElementById('ovPatients').textContent = d.totalPatients;
    } catch (err) {
        console.error('Failed to load overview:', err);
    }
}

// ---- Charts (real hospital analytics, see js/charts.js) ----
async function loadCharts() {
    try {
        const res = await AdminAuth.authFetch('/api/admin/stats/charts');
        const c = await res.json();

        ChartKit.renderLineChart(document.getElementById('chartPerDay'), c.appointmentsPerDay, {
            xKey: 'd', yKey: 'cnt', formatLabel: (v) => v.slice(5),
            formatValue: (v) => `${v} appt${v === 1 ? '' : 's'}`,
            formatTooltipLabel: formatFullDate,
            onPointClick: (d) => { window.location.href = `appointments.html?date=${d.d}`; }
        });
        ChartKit.renderBarChart(document.getElementById('chartByDept'), c.appointmentsByDepartment, {
            xKey: 'department', yKey: 'cnt', color: ChartKit.palette()[1]
        });
        ChartKit.renderBarChart(document.getElementById('chartWorkload'), c.doctorWorkload, {
            xKey: 'doctor', yKey: 'cnt', color: ChartKit.palette()[0], formatLabel: (v) => 'Dr. ' + v
        });

        const cancellationRate = c.cancellationTrend.map(r => ({
            d: r.d, rate: r.total > 0 ? Math.round((r.cancelled / r.total) * 1000) / 10 : 0
        }));
        ChartKit.renderLineChart(document.getElementById('chartCancellation'), cancellationRate, {
            xKey: 'd', yKey: 'rate', color: ChartKit.palette()[7], formatValue: (v) => v + '%', formatLabel: (v) => v.slice(5),
            formatTooltipLabel: formatFullDate,
            onPointClick: (d) => { window.location.href = `appointments.html?date=${d.d}&status=Cancelled`; }
        });

        const hourData = Array.from({ length: 24 }, (_, h) => ({
            hr: h, cnt: c.peakBookingHours.find(r => r.hr === h)?.cnt || 0
        }));
        ChartKit.renderBarChart(document.getElementById('chartPeakHours'), hourData, {
            xKey: 'hr', yKey: 'cnt', color: ChartKit.palette()[5], formatLabel: (v) => v + ':00'
        });

        const shiftData = ['Morning', 'Afternoon', 'Evening'].map(s => ({
            shift: s, cnt: c.queueLoadByShift.find(r => r.shift === s)?.cnt || 0
        }));
        ChartKit.renderBarChart(document.getElementById('chartQueueShift'), shiftData, {
            xKey: 'shift', yKey: 'cnt', color: ChartKit.palette()[4]
        });

        ChartKit.renderBarChart(document.getElementById('chartMonthly'), c.monthlyGrowth, {
            xKey: 'ym', yKey: 'cnt', color: ChartKit.palette()[6]
        });
    } catch (err) {
        console.error('Failed to load charts:', err);
    }
}

loadStats();
loadOverview();
loadCharts();
// Real-time-ish refresh per spec. loadCharts was missing from this list —
// stats/overview kept themselves current but the charts silently went stale
// until a manual page reload, which is exactly the "keep refreshing" bug.
setInterval(loadStats, 30000);
setInterval(loadOverview, 30000);
setInterval(loadCharts, 30000);

// Charts compute their SVG width from container.clientWidth at render time
// (see charts.js); the CSS-level `width:100%` keeps them from ever
// overflowing between renders, but a real viewport resize (e.g. rotating a
// tablet, or resizing a browser window) should re-lay-out the bars/lines
// against the new width rather than waiting up to 30s for the next poll.
let chartResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(chartResizeTimer);
    chartResizeTimer = setTimeout(loadCharts, 250);
});

// ---- Live Queue ----
// Pushed over SSE (see queue/stream) rather than polled — the dashboard
// updates the instant a patient is marked done or a new WhatsApp booking
// lands, with no manual refresh or fixed poll interval.
let queueEventSource = null;
let currentAppointmentId = null;
let queueDoctorId = null;
let queueShift = null;

async function loadQueueDoctors() {
    const res = await AdminAuth.authFetch('/api/admin/doctors');
    const data = await res.json();
    const select = document.getElementById('queueDoctorSelect');
    data.doctors.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `Dr. ${d.name}${d.is_on_leave ? ' (on leave)' : ''}`;
        select.appendChild(opt);
    });
}

function queueStatusBadge(status) {
    if (status === 'Completed') return '<span class="badge badge-completed-queue">Done</span>';
    return `<span class="badge badge-${status.toLowerCase()}">${status}</span>`;
}

function renderQueueTable(queue) {
    const tbody = document.getElementById('queueTableBody');
    tbody.innerHTML = '';
    const firstActiveId = queue.find(a => a.status !== 'Completed')?.id;

    queue.forEach(a => {
        const tr = document.createElement('tr');
        if (a.id === firstActiveId) tr.className = 'queue-row-current';
        tr.innerHTML = `
            <td data-label="Token"><strong>#${a.token_number}</strong></td>
            <td data-label="Patient">${escapeHtml(a.patient_name)}</td>
            <td data-label="Phone">${escapeHtml(a.phone_number)}</td>
            <td data-label="Age/Gender">${a.age} / ${a.gender}</td>
            <td data-label="Expected Time">${a.expected_time}</td>
            <td data-label="Status">${a.id === firstActiveId ? '<span class="badge badge-current-queue">Current</span>' : queueStatusBadge(a.status)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// "9:00 AM" -> minutes since midnight, so Avg Wait / Est Finish can be derived
// from the same expected_time values already computed at booking (see
// scheduleService.computeExpectedTime) instead of re-deriving them server-side.
function parseClockToMinutes(str) {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((str || '').trim());
    if (!m) return null;
    let [, h, min, ampm] = m;
    h = parseInt(h, 10) % 12;
    if (ampm.toUpperCase() === 'PM') h += 12;
    return h * 60 + parseInt(min, 10);
}

function renderQueueStats(data) {
    document.getElementById('qCurrentToken').textContent = data.current_token ?? '—';
    document.getElementById('qCurrentName').textContent = data.current_patient?.patient_name || '—';
    document.getElementById('qSeenCount').textContent = data.seen_count;
    document.getElementById('qRemainingCount').textContent = data.remaining_count;
    document.getElementById('qNextToken').textContent = data.next_token ?? '—';
    document.getElementById('qNextName').textContent = data.next_patient?.patient_name || '—';
    currentAppointmentId = data.current_patient?.id || null;

    const active = (data.queue || []).filter(a => a.status !== 'Completed' && a.status !== 'Cancelled');
    if (active.length > 0) {
        const last = active[active.length - 1];
        document.getElementById('qEstFinish').textContent = last.expected_time;
        if (active.length > 1) {
            const firstMin = parseClockToMinutes(active[0].expected_time);
            const lastMin = parseClockToMinutes(last.expected_time);
            if (firstMin !== null && lastMin !== null) {
                const avg = Math.round((lastMin - firstMin) / (active.length - 1));
                document.getElementById('qAvgWait').textContent = avg + ' min';
            } else {
                document.getElementById('qAvgWait').textContent = '—';
            }
        } else {
            document.getElementById('qAvgWait').textContent = '—';
        }
    } else {
        document.getElementById('qEstFinish').textContent = '—';
        document.getElementById('qAvgWait').textContent = '—';
    }
}

function renderQueueUpdate(data) {
    document.getElementById('queueEmptyState').style.display = data.queue.length === 0 ? 'block' : 'none';
    document.getElementById('queueContent').style.display = data.queue.length === 0 ? 'none' : 'block';
    renderQueueStats(data);
    renderQueueTable(data.queue);
    document.getElementById('qLastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

function loadQueue() {
    queueDoctorId = document.getElementById('queueDoctorSelect').value;
    queueShift = document.getElementById('queueShiftSelect').value;
    if (!queueDoctorId) { Toast.show('Select a doctor first.', 'error'); return; }

    if (queueEventSource) queueEventSource.close();

    const url = `/api/admin/queue/stream?doctor_id=${queueDoctorId}&shift=${queueShift}&token=${encodeURIComponent(AdminAuth.getToken())}`;
    queueEventSource = new EventSource(url);

    queueEventSource.onopen = () => {
        document.getElementById('queueLiveBadge').style.display = 'inline-flex';
    };
    queueEventSource.onmessage = (event) => renderQueueUpdate(JSON.parse(event.data));
    queueEventSource.onerror = () => {
        // The browser retries the connection on its own; just reflect the
        // drop so staff know the numbers on screen may be stale meanwhile.
        document.getElementById('queueLiveBadge').style.display = 'none';
    };
}

document.getElementById('loadQueueBtn').addEventListener('click', loadQueue);

document.getElementById('markDoneBtn').addEventListener('click', async () => {
    if (!currentAppointmentId) { Toast.show('No current patient in queue.', 'error'); return; }
    try {
        const res = await AdminAuth.authFetch('/api/admin/queue/next', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appointment_id: currentAppointmentId })
        });
        const data = await res.json();
        if (!res.ok) Toast.show(data.error || 'Could not mark as done', 'error');
        // No manual refresh — the server pushes the updated queue over SSE.
    } catch (err) {
        console.error('Mark-done failed:', err);
    }
});

loadQueueDoctors();
