// Dark mode toggle, shared by every page (including the pre-auth login page,
// so it has no dependency on auth.js). The actual attribute is set earlier by
// a tiny inline script in each page's <head> (before first paint, so there's
// no flash of the wrong theme) — this file just wires up the toggle control
// and keeps its visual state (switch position, icon, label) in sync.
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    document.querySelectorAll('[data-theme-switch]').forEach(el => el.classList.toggle('on', theme === 'dark'));
    document.querySelectorAll('[data-theme-icon]').forEach(el => el.textContent = theme === 'dark' ? '☀️' : '🌙');
    document.querySelectorAll('[data-theme-label]').forEach(el => el.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode');
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    setTheme(current === 'dark' ? 'light' : 'dark');
}

document.addEventListener('DOMContentLoaded', () => {
    setTheme(document.documentElement.getAttribute('data-theme') || 'light');
    document.querySelectorAll('[data-theme-toggle]').forEach(el => el.addEventListener('click', toggleTheme));
});
