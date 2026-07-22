// Shared auth helpers used by every admin page, plus the login form handler
// (only wired up if #loginForm is present on the current page).
const AdminAuth = {
    // "Remember me" decides WHERE the token lives, not how long the JWT
    // itself is valid (that's still the server's JWT_EXPIRES_IN either way).
    // Checked (default): localStorage — survives closing the browser, same
    // as this app's original always-localStorage behavior. Unchecked:
    // sessionStorage — cleared when the tab/window closes, for a shared/
    // public machine. getToken/getAdmin check localStorage first so every
    // existing "remembered" session (and every page that doesn't know about
    // this choice) keeps working exactly as before.
    getToken() { return localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token'); },
    getAdmin() {
        const raw = localStorage.getItem('admin_info') || sessionStorage.getItem('admin_info');
        return raw ? JSON.parse(raw) : null;
    },
    setSession(token, admin, remember = true) {
        const store = remember ? localStorage : sessionStorage;
        store.setItem('admin_token', token);
        store.setItem('admin_info', JSON.stringify(admin));
    },
    clearSession() {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_info');
        sessionStorage.removeItem('admin_token');
        sessionStorage.removeItem('admin_info');
    },
    // Call on every protected page's load: bounces to the login page if
    // there's no token, so a bookmarked dashboard URL can't be viewed logged-out.
    requireAuth() {
        if (!this.getToken()) {
            window.location.href = 'index.html';
        }
    },
    async logout() {
        try {
            await fetch(API_BASE_URL + '/api/admin/logout', {
                method: 'POST',
                headers: { Authorization: `Bearer ${this.getToken()}` }
            });
        } catch (e) { /* best-effort; clear local session regardless */ }
        this.clearSession();
        window.location.href = 'index.html';
    },
    // fetch() wrapper that attaches the bearer token and redirects to login
    // on a 401 (expired/invalid token) instead of every page re-deriving that.
    async authFetch(url, options = {}) {
        const res = await fetch(API_BASE_URL + url, {
            ...options,
            headers: { ...(options.headers || {}), Authorization: `Bearer ${this.getToken()}` }
        });
        if (res.status === 401) {
            this.clearSession();
            window.location.href = 'index.html';
            throw new Error('Unauthorized');
        }
        return res;
    }
};

// ---- Password show/hide toggle (any input referenced by a [data-toggle-for] button) ----
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

// ---- Forgot Password (WhatsApp OTP) ----
const forgotLink = document.getElementById('forgotLink');
const forgotModal = document.getElementById('forgotModal');
if (forgotLink && forgotModal) {
    let resetEmail = '';

    function showStep(stepId) {
        document.querySelectorAll('.reset-step').forEach(s => s.classList.remove('active'));
        document.getElementById(stepId).classList.add('active');
    }

    forgotLink.addEventListener('click', () => {
        document.getElementById('forgotEmail').value = document.getElementById('email').value || '';
        document.getElementById('forgotError').textContent = '';
        showStep('stepEmail');
        forgotModal.classList.add('show');
    });
    document.getElementById('forgotCancelBtn').addEventListener('click', () => forgotModal.classList.remove('show'));
    forgotModal.addEventListener('click', (e) => { if (e.target === forgotModal) forgotModal.classList.remove('show'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') forgotModal.classList.remove('show'); });

    async function sendCode() {
        const errorText = document.getElementById('forgotError');
        errorText.textContent = '';
        const email = document.getElementById('forgotEmail').value.trim();
        if (!email) { errorText.textContent = 'Please enter your email.'; return; }

        try {
            const res = await fetch(API_BASE_URL + '/api/admin/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (!res.ok) { errorText.textContent = data.error || 'Something went wrong.'; return; }

            resetEmail = email;
            document.getElementById('codeSentMsg').textContent =
                `If ${email} has a phone number on file, a 6-digit code was sent via WhatsApp. It expires in 10 minutes.`;
            document.getElementById('resetCode').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('resetError').textContent = '';
            showStep('stepReset');
        } catch (err) {
            errorText.textContent = 'Could not reach the server.';
        }
    }
    document.getElementById('sendCodeBtn').addEventListener('click', sendCode);
    document.getElementById('resendCodeBtn').addEventListener('click', sendCode);

    document.getElementById('confirmResetBtn').addEventListener('click', async () => {
        const errorText = document.getElementById('resetError');
        errorText.textContent = '';
        const code = document.getElementById('resetCode').value.trim();
        const newPassword = document.getElementById('newPassword').value;

        if (!code || !newPassword) { errorText.textContent = 'Enter the code and a new password.'; return; }
        if (newPassword.length < 6) { errorText.textContent = 'Password must be at least 6 characters.'; return; }

        try {
            const res = await fetch(API_BASE_URL + '/api/admin/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: resetEmail, code, newPassword })
            });
            const data = await res.json();
            if (!res.ok) { errorText.textContent = data.error || 'Could not reset password.'; return; }

            forgotModal.classList.remove('show');
            document.getElementById('email').value = resetEmail;
            document.getElementById('password').value = '';
            document.getElementById('errorText').textContent = '';
            const success = document.createElement('div');
            success.className = 'success-text';
            success.textContent = '✅ Password reset — please log in with your new password.';
            document.getElementById('loginForm').appendChild(success);
        } catch (err) {
            errorText.textContent = 'Could not reach the server.';
        }
    });
}

const loginForm = document.getElementById('loginForm');
if (loginForm) {
    const loginSubmitBtn = document.getElementById('loginSubmitBtn');
    const rememberMeBox = document.getElementById('rememberMe');
    // toast.js is only loaded on the login/register pages, not every
    // authenticated page — guard so this block never throws if it's absent.
    const notify = (msg, type) => { if (typeof Toast !== 'undefined') Toast.show(msg, type); };

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorText = document.getElementById('errorText');
        errorText.textContent = '';

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        if (loginSubmitBtn) {
            loginSubmitBtn.disabled = true;
            loginSubmitBtn.innerHTML = '<span class="btn-spinner"></span>Logging in…';
        }

        try {
            const res = await fetch(API_BASE_URL + '/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();

            if (!res.ok) {
                errorText.textContent = data.error || 'Login failed';
                notify(data.error || 'Login failed', 'error');
                return;
            }

            AdminAuth.setSession(data.token, data.admin, rememberMeBox ? rememberMeBox.checked : true);
            notify('Login successful', 'success');
            window.location.href = 'dashboard.html';
        } catch (err) {
            errorText.textContent = 'Could not reach the server. Please try again.';
            notify('Could not reach the server.', 'error');
        } finally {
            if (loginSubmitBtn && !window.location.href.includes('dashboard.html')) {
                loginSubmitBtn.disabled = false;
                loginSubmitBtn.innerHTML = 'Log In';
            }
        }
    });
}
