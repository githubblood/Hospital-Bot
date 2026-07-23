// Hospital self-registration form: client-side validation + password
// strength meter (mirrors backend/src/validators/validators.js::scorePassword exactly —
// keep the two in sync if the scoring rule ever changes, since this is a
// plain static page with no bundler to share the module directly), logo
// preview, and a multipart submit (FormData, not JSON, because of the file).

const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];

function scorePassword(pw) {
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[a-z]/.test(pw)) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 4);
}

const passwordInput = document.getElementById('password');
const strengthMeter = document.getElementById('strengthMeter');
const strengthLabel = document.getElementById('strengthLabel');

passwordInput.addEventListener('input', () => {
    const score = scorePassword(passwordInput.value);
    strengthMeter.className = 'strength-meter strength-' + score;
    strengthLabel.textContent = passwordInput.value ? STRENGTH_LABELS[score] : '';
});

// ---- Logo preview ----
const logoInput = document.getElementById('logoInput');
const logoPreview = document.getElementById('logoPreview');
let logoFile = null;

logoInput.addEventListener('change', () => {
    const file = logoInput.files[0];
    if (!file) { logoFile = null; return; }
    if (file.size > 2 * 1024 * 1024) {
        Toast.show('Logo must be 2MB or smaller.', 'error');
        logoInput.value = '';
        logoFile = null;
        return;
    }
    logoFile = file;
    const reader = new FileReader();
    reader.onload = (e) => { logoPreview.innerHTML = `<img src="${e.target.result}" alt="Logo preview">`; };
    reader.readAsDataURL(file);
});

// ---- Submit ----
const form = document.getElementById('registerForm');
const submitBtn = document.getElementById('submitBtn');
const errorText = document.getElementById('errorText');
const successText = document.getElementById('successText');

function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.innerHTML = loading ? '<span class="btn-spinner"></span>Creating account…' : 'Create Hospital Account';
}

function val(id) { return document.getElementById(id).value.trim(); }

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorText.textContent = '';
    successText.textContent = '';

    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const agreeTerms = document.getElementById('agreeTerms').checked;

    // Client-side mirror of hospitalRegistrationService.validateRegistration —
    // the server re-checks everything regardless, this is just fast feedback.
    if (password !== confirmPassword) {
        errorText.textContent = 'Password and Confirm Password do not match.';
        Toast.show('Passwords do not match.', 'error');
        return;
    }
    if (password.length < 8 || scorePassword(password) < 3) {
        errorText.textContent = 'Password must be at least 8 characters and reasonably strong (mix of upper/lower case, numbers, symbols).';
        Toast.show('Please choose a stronger password.', 'error');
        return;
    }
    if (!agreeTerms) {
        errorText.textContent = 'You must agree to the Terms & Conditions to continue.';
        return;
    }

    const fd = new FormData();
    fd.append('hospital_name', val('hospitalName'));
    fd.append('hospital_email', val('hospitalEmail'));
    fd.append('hospital_phone', val('hospitalPhone'));
    fd.append('address', val('address'));
    fd.append('city', val('city'));
    fd.append('state', val('state'));
    fd.append('country', val('country'));
    fd.append('pincode', val('pincode'));
    fd.append('admin_name', val('adminName'));
    fd.append('admin_email', val('adminEmail'));
    fd.append('admin_phone', val('adminPhone'));
    fd.append('password', password);
    fd.append('confirm_password', confirmPassword);
    fd.append('agree_terms', 'true');
    if (logoFile) fd.append('logo', logoFile);

    setLoading(true);
    try {
        const res = await fetch(API_BASE_URL + '/api/admin/register-hospital', { method: 'POST', body: fd });
        const data = await res.json();

        if (!res.ok) {
            errorText.textContent = data.error || 'Registration failed. Please check the form and try again.';
            Toast.show(data.error || 'Registration failed.', 'error');
            setLoading(false);
            return;
        }

        successText.textContent = '✅ Hospital account created successfully.';
        Toast.show('Hospital account created successfully!', 'success');
        form.querySelectorAll('input, button').forEach(el => { el.disabled = true; });
        setTimeout(() => { window.location.href = 'index.html'; }, 1800);
    } catch (err) {
        errorText.textContent = 'Could not reach the server. Please try again.';
        Toast.show('Could not reach the server.', 'error');
        setLoading(false);
    }
});
