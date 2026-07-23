// Shared behavior for the global top bar + sidebar user block, wired the same
// way on every authenticated admin page. Requires auth.js and avatar.js to
// already be loaded.
AdminAuth.requireAuth();

// Both functions below re-read AdminAuth.getAdmin() fresh on every call
// rather than closing over a snapshot taken once at page load — settings.js
// updates the *localStorage* copy after a save (so it survives a future page
// load), but a stale in-memory snapshot here would otherwise never see that
// update on the *current* page until a reload, even though the save itself
// succeeded. (Previously this file cached `_admin` once at the top and both
// functions read that snapshot — a real bug: changing your name/role in
// Settings and calling renderSidebarUser() again silently kept showing the
// old value until the next full page load.)

// Primary line is the logged-in admin's own name; secondary is their role
// (Hospital Administrator / Receptionist / Super Admin). The hospital name
// already has its own home — the topbar's brand text (see renderBrandName)
// — so it's only used here as a fallback, and only when the admin's name
// itself isn't available, to avoid ever showing the hospital name twice.
function renderSidebarUser() {
    const admin = AdminAuth.getAdmin();
    const el = document.getElementById('sidebarUser');
    if (!el || !admin) return;
    const primary = admin.name || admin.hospital_name || admin.email || '';
    const secondary = admin.name ? (admin.role || admin.hospital_name || '') : (admin.hospital_name || '');
    el.innerHTML = `
        ${Avatar.html(primary)}
        <div class="user-info">
            <div class="name">${escapeHtml(primary)}</div>
            <div class="email">${escapeHtml(secondary)}</div>
        </div>
    `;
}

// The topbar's brand name reads as the actual hospital's name (from the JWT
// login payload — see adminAuthController.login), not a hardcoded product
// label. Settings > Hospital Info re-calls this after a rename so the header
// updates without needing a fresh login.
function renderBrandName() {
    const admin = AdminAuth.getAdmin();
    document.querySelectorAll('.brand-name').forEach(el => {
        el.textContent = admin?.hospital_name || 'Hospital Bot';
    });
}

function closeAllDropdowns(except) {
    document.querySelectorAll('.dropdown-panel.open').forEach(p => {
        if (p !== except) p.classList.remove('open');
    });
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#globalSearchWrap')) closeAllDropdowns();
    if (!e.target.closest('#activityWrap')) document.getElementById('activityPanel')?.classList.remove('open');
});

// ---- Logout ---- a standalone button at the bottom of the left sidebar,
// below the nav modules. Still goes through a confirm modal — closable via
// Cancel, backdrop click, or Escape.
const logoutBtn = document.getElementById('sidebarLogoutBtn');
const logoutModal = document.getElementById('logoutModal');
if (logoutBtn && logoutModal) {
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logoutModal.classList.add('show');
    });
    document.getElementById('logoutCancelBtn')?.addEventListener('click', () => logoutModal.classList.remove('show'));
    document.getElementById('logoutConfirmBtn')?.addEventListener('click', () => AdminAuth.logout());
    logoutModal.addEventListener('click', (e) => {
        if (e.target === logoutModal) logoutModal.classList.remove('show');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') logoutModal.classList.remove('show');
    });
}

// ---- Recent activity (real data: new patients + new bookings) ----
const activityBtn = document.getElementById('activityBtn');
if (activityBtn) {
    activityBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const panel = document.getElementById('activityPanel');
        const opening = !panel.classList.contains('open');
        closeAllDropdowns();
        if (!opening) return;
        panel.classList.add('open');

        panel.querySelector('.dropdown-body').innerHTML = '<div class="dropdown-empty">Loading…</div>';
        try {
            const res = await AdminAuth.authFetch('/api/admin/activity');
            const data = await res.json();
            const body = panel.querySelector('.dropdown-body');
            if (data.activity.length === 0) {
                body.innerHTML = '<div class="dropdown-empty">No recent activity.</div>';
            } else {
                body.innerHTML = data.activity.map(a => `
                    <div class="dropdown-item">
                        ${escapeHtml(a.text)}
                        <small>${escapeHtml(new Date(a.time).toLocaleString())}</small>
                    </div>
                `).join('');
            }
            document.getElementById('activityDot').style.display = 'none';
        } catch (err) {
            panel.querySelector('.dropdown-body').innerHTML = '<div class="dropdown-empty">Could not load activity.</div>';
        }
    });
}

// ---- Global search (real data: patients by name/phone, doctors by name) ----
const searchInput = document.getElementById('globalSearchInput');
if (searchInput) {
    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const q = searchInput.value.trim();
        if (q.length < 2) {
            closeAllDropdowns();
            return;
        }
        debounceTimer = setTimeout(() => runGlobalSearch(q), 300);
    });
    searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim().length >= 2) runGlobalSearch(searchInput.value.trim());
    });
}

async function runGlobalSearch(q) {
    const panel = document.getElementById('globalSearchPanel');
    panel.classList.add('open');
    panel.innerHTML = '<div class="dropdown-empty">Searching…</div>';

    try {
        const [patRes, docRes] = await Promise.all([
            AdminAuth.authFetch(`/api/admin/patients?search=${encodeURIComponent(q)}`),
            AdminAuth.authFetch(`/api/admin/doctors?search=${encodeURIComponent(q)}`)
        ]);
        const patients = (await patRes.json()).patients.slice(0, 5);
        const doctors = (await docRes.json()).doctors.slice(0, 5);

        if (patients.length === 0 && doctors.length === 0) {
            panel.innerHTML = '<div class="dropdown-empty">No matches.</div>';
            return;
        }

        let html = '';
        if (patients.length > 0) {
            html += '<div class="dropdown-header">Patients</div>';
            html += patients.map(p => `
                <button type="button" class="dropdown-item" data-href="patients.html?search=${encodeURIComponent(p.phone_number)}">
                    ${escapeHtml(p.name)}<small>${escapeHtml(p.phone_number)}</small>
                </button>
            `).join('');
        }
        if (doctors.length > 0) {
            html += '<div class="dropdown-header">Doctors</div>';
            html += doctors.map(d => `
                <button type="button" class="dropdown-item" data-href="doctors.html?search=${encodeURIComponent(d.name)}">
                    Dr. ${escapeHtml(d.name)}<small>${escapeHtml(d.department_name || '')}</small>
                </button>
            `).join('');
        }
        panel.innerHTML = html;
        panel.querySelectorAll('[data-href]').forEach(btn => {
            btn.addEventListener('click', () => { window.location.href = btn.dataset.href; });
        });
    } catch (err) {
        panel.innerHTML = '<div class="dropdown-empty">Search failed.</div>';
    }
}

// ---- "Today" date chip: shows the real current date; the invisible native
// date input overlaid on it is a genuine (if minimal) date picker rather than
// a decorative label. Local Y/M/D components, not toISOString() — the same
// IST off-by-one shift already fixed elsewhere in this project (see
// scheduleService.js) was showing the wrong "today" here too whenever local
// time was still behind UTC midnight. ----
const dateInput = document.getElementById('topbarDateInput');
const dateLabel = document.getElementById('topbarDateLabel');
if (dateInput && dateLabel) {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    dateInput.value = todayStr;
    dateInput.addEventListener('change', () => {
        if (!dateInput.value) return;
        const picked = new Date(dateInput.value + 'T00:00:00');
        dateLabel.textContent = dateInput.value === todayStr
            ? 'Today'
            : picked.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    });
}

// ---- "Generate Report" — downloads a real CSV of today's stats, not a
// decorative button. ----
const reportBtn = document.getElementById('generateReportBtn');
if (reportBtn) {
    reportBtn.addEventListener('click', async () => {
        const originalText = reportBtn.innerHTML;
        reportBtn.disabled = true;
        reportBtn.textContent = 'Generating…';
        try {
            const res = await AdminAuth.authFetch('/api/admin/reports/today');
            if (!res.ok) throw new Error('Report request failed');

            // A blob: URL carries none of the original response's headers, so
            // the server's Content-Disposition filename (CURDATE()-derived —
            // see adminReportService) has to be read off the response here,
            // not recomputed client-side. Recomputing it with
            // `new Date().toISOString()` was the same IST off-by-one bug as
            // the date chip above, just duplicated into a filename.
            const disposition = res.headers.get('Content-Disposition') || '';
            const filenameMatch = /filename="([^"]+)"/.exec(disposition);
            const filename = filenameMatch ? filenameMatch[1] : `report-${dateInput ? dateInput.value : ''}.pdf`;

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            Toast.show('Could not generate report.', 'error');
        } finally {
            reportBtn.disabled = false;
            reportBtn.innerHTML = originalText;
        }
    });
}

// ---- Collapsible sidebar sections (Main / Management / System) ----
// Collapsed state persists per section across pages via localStorage, so
// staff who collapse a section once don't have to redo it on every page.
const SIDEBAR_SECTIONS_KEY = 'sidebarCollapsedSections';

function getCollapsedSections() {
    try { return JSON.parse(localStorage.getItem(SIDEBAR_SECTIONS_KEY)) || {}; }
    catch (e) { return {}; }
}

function setSectionCollapsed(section, collapsed) {
    const header = document.querySelector(`.nav-section-header[data-section="${section}"]`);
    const body = document.querySelector(`.nav-section-body[data-section-body="${section}"]`);
    if (!header || !body) return;
    header.setAttribute('aria-expanded', String(!collapsed));
    body.classList.toggle('collapsed', collapsed);
}

document.querySelectorAll('.nav-section-header').forEach(header => {
    header.addEventListener('click', () => {
        const section = header.dataset.section;
        const collapsed = header.getAttribute('aria-expanded') === 'true';
        setSectionCollapsed(section, collapsed);
        const saved = getCollapsedSections();
        saved[section] = collapsed;
        localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(saved));
    });
});

const collapsedSections = getCollapsedSections();
Object.keys(collapsedSections).forEach(section => {
    if (collapsedSections[section]) setSectionCollapsed(section, true);
});

// ---- Sidebar collapse/expand (desktop only) ----
// Single source of truth is the `sidebar-collapsed` class on <html>, not on
// .sidebar itself — the same class is already applied pre-paint by a tiny
// inline script in <head> (avoiding a flash of the expanded sidebar on a
// page load where the user had it collapsed), so this only needs to keep
// the toggle button's own state in sync and handle clicks; it never needs
// to apply the class itself on initial load.
const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed';
const collapseBtn = document.getElementById('sidebarCollapseBtn');

function syncCollapseButton(collapsed) {
    if (!collapseBtn) return;
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    collapseBtn.setAttribute('aria-label', label);
    collapseBtn.title = label;
}

if (collapseBtn) {
    syncCollapseButton(document.documentElement.classList.contains('sidebar-collapsed'));
    collapseBtn.addEventListener('click', () => {
        const collapsed = document.documentElement.classList.toggle('sidebar-collapsed');
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
        syncCollapseButton(collapsed);
    });
}

// Tooltip text (shown only in the collapsed state, via CSS's
// ::after{content:attr(data-tooltip)}) and each link's aria-label are both
// derived from the same .nav-label span already in the markup, rather than
// hand-duplicating every module name a third time — one label, three uses
// (visible text, tooltip, screen reader).
document.querySelectorAll('.sidebar nav a, .sidebar-logout-btn').forEach(el => {
    const label = el.querySelector('.nav-label');
    if (!label) return;
    const text = label.textContent.trim();
    el.setAttribute('data-tooltip', text);
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', text);
});

// ---- Mobile sidebar drawer ----
// Desktop/tablet: sidebar is permanently visible via CSS (see style.css's
// responsive section) and this code simply has nothing to do (the elements
// exist but the drawer-open class never gets toggled by anything relevant).
// Mobile: the sidebar is off-canvas by default; the hamburger button slides
// it in over a dimmed overlay, and clicking the overlay (or a nav link, or
// Escape) closes it again — same interaction pattern as the existing
// logout-modal handling elsewhere in this file.
const hamburgerBtn = document.getElementById('hamburgerBtn');
const sidebarEl = document.querySelector('.sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');

// .app-shell is already height:100vh/overflow:hidden (so the document itself
// never scrolls — see that rule's own comment), but .main-content has its
// own independent overflow-y:auto region, and that keeps scrolling under a
// user's finger even while the drawer sits on top of it, dimmed. This class
// pins .main-content still for as long as the drawer is open — see
// style.css's `body.sidebar-drawer-open` rule.
function openSidebar() {
    sidebarEl?.classList.add('open');
    sidebarOverlay?.classList.add('show');
    document.body.classList.add('sidebar-drawer-open');
}
function closeSidebar() {
    sidebarEl?.classList.remove('open');
    sidebarOverlay?.classList.remove('show');
    document.body.classList.remove('sidebar-drawer-open');
}

if (hamburgerBtn && sidebarEl && sidebarOverlay) {
    hamburgerBtn.addEventListener('click', () => {
        sidebarEl.classList.contains('open') ? closeSidebar() : openSidebar();
    });
    sidebarOverlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar(); });
    // Picking a page from the drawer should close it, not leave it open
    // underneath the page that's about to load.
    sidebarEl.querySelectorAll('nav a').forEach(a => a.addEventListener('click', closeSidebar));
}

renderSidebarUser();
renderBrandName();
