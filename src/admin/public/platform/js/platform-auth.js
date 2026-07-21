// Deliberately separate from js/auth.js's AdminAuth — distinct storage keys
// (platform_token/platform_info, not admin_token/admin_info) so a platform
// session and a hospital-admin session can coexist in the same browser
// without ever colliding or reading each other's token.
const PlatformAuth = {
    getToken() { return localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token'); },
    getAdmin() {
        const raw = localStorage.getItem('platform_info') || sessionStorage.getItem('platform_info');
        return raw ? JSON.parse(raw) : null;
    },
    setSession(token, admin, remember = true) {
        const store = remember ? localStorage : sessionStorage;
        store.setItem('platform_token', token);
        store.setItem('platform_info', JSON.stringify(admin));
    },
    clearSession() {
        localStorage.removeItem('platform_token');
        localStorage.removeItem('platform_info');
        sessionStorage.removeItem('platform_token');
        sessionStorage.removeItem('platform_info');
    },
    requireAuth() {
        if (!this.getToken()) {
            window.location.href = 'login.html';
        }
    },
    async logout() {
        try {
            await fetch('/api/platform/logout', { method: 'POST', headers: { Authorization: `Bearer ${this.getToken()}` } });
        } catch (e) { /* best-effort; clear local session regardless */ }
        this.clearSession();
        window.location.href = 'login.html';
    },
    async authFetch(url, options = {}) {
        const res = await fetch(url, {
            ...options,
            headers: { ...(options.headers || {}), Authorization: `Bearer ${this.getToken()}` }
        });
        if (res.status === 401) {
            this.clearSession();
            window.location.href = 'login.html';
            throw new Error('Unauthorized');
        }
        return res;
    }
};

// ---- Shared topbar/sidebar wiring (present on every page except login.html) ----
document.addEventListener('DOMContentLoaded', () => {
    const nameEl = document.getElementById('platformAdminName');
    if (nameEl) {
        const admin = PlatformAuth.getAdmin();
        nameEl.textContent = admin ? admin.name : '';
    }
    const logoutBtn = document.getElementById('platformLogoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => PlatformAuth.logout());

    // Mobile off-canvas drawer — same interaction pattern as js/topbar.js's
    // hamburger handling, copied rather than shared since that file also
    // wires up global search/activity/report-button machinery the platform
    // panel has no equivalent of.
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const sidebarEl = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
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
        sidebarEl.querySelectorAll('nav a').forEach(a => a.addEventListener('click', closeSidebar));
    }
});
