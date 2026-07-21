// ---- Password show/hide toggle (same small widget js/auth.js provides for
// the hospital-admin login page — copied here rather than shared, since
// auth.js is otherwise tightly coupled to AdminAuth/the hospital login form
// and pulling it in would be more confusing than this few lines duplicated). ----
const EYE_OPEN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61C3.35 8.36 1 12 1 12s4 8 11 8a9.26 9.26 0 0 0 5.39-1.61M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>';

document.querySelectorAll('.password-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.toggleFor);
        if (!input) return;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.innerHTML = showing ? EYE_OPEN : EYE_CLOSED;
        btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
});

// ---- Login ----
const platformLoginForm = document.getElementById('platformLoginForm');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');
const rememberMeBox = document.getElementById('rememberMe');
const notify = (msg, type) => { if (typeof Toast !== 'undefined') Toast.show(msg, type); };

platformLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorText = document.getElementById('errorText');
    errorText.textContent = '';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    loginSubmitBtn.disabled = true;
    loginSubmitBtn.innerHTML = '<span class="btn-spinner"></span>Logging in…';

    try {
        const res = await fetch('/api/platform/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (!res.ok) {
            errorText.textContent = data.error || 'Login failed';
            notify(data.error || 'Login failed', 'error');
            return;
        }

        PlatformAuth.setSession(data.token, data.admin, rememberMeBox.checked);
        notify('Login successful', 'success');
        window.location.href = 'dashboard.html';
    } catch (err) {
        errorText.textContent = 'Could not reach the server. Please try again.';
        notify('Could not reach the server.', 'error');
    } finally {
        if (!window.location.href.includes('dashboard.html')) {
            loginSubmitBtn.disabled = false;
            loginSubmitBtn.innerHTML = 'Log In';
        }
    }
});
