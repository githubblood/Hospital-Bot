// Minimal shared toast notification component. Self-contained (no
// dependency on auth.js/theme.js), so it can be loaded on both the
// pre-login pages (index.html, register.html) and, later, any authenticated
// page. Usage: Toast.show('Message', 'success' | 'error' | 'info').
const Toast = (function () {
    let container = null;

    function ensureContainer() {
        if (container) return container;
        container = document.createElement('div');
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
        return container;
    }

    const ICONS = { success: '✅', error: '⚠️', info: 'ℹ️' };

    function show(message, type = 'info', durationMs = 4000) {
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.innerHTML = `<span class="toast-icon">${ICONS[type] || ICONS.info}</span><span class="toast-msg"></span>`;
        // textContent, not innerHTML, for the message itself — messages can
        // include a hospital/admin name the user just typed.
        el.querySelector('.toast-msg').textContent = message;

        ensureContainer().appendChild(el);
        requestAnimationFrame(() => el.classList.add('toast-show'));

        setTimeout(() => {
            el.classList.remove('toast-show');
            setTimeout(() => el.remove(), 250);
        }, durationMs);
    }

    return { show };
})();
