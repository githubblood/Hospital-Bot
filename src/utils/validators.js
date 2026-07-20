// Shared input-validation helpers — the single source of truth for what
// counts as a valid email/password/phone across every public-facing form
// (currently just hospital self-registration, but written generically so
// login/settings can reuse it later instead of re-deriving these rules).

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 10-15 digits, optional leading +. Deliberately loose (no country-specific
// format) since this app already stores WhatsApp numbers in varying formats
// elsewhere (see patients.phone_number) — matching that precedent rather
// than inventing a stricter rule that would reject real numbers.
const PHONE_REGEX = /^\+?[0-9]{10,15}$/;

function isValidEmail(email) {
    return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

function isValidPhone(phone) {
    return typeof phone === 'string' && PHONE_REGEX.test(phone.trim());
}

// Password strength scoring shared by the server-side gate and the client's
// visual strength meter (register.js mirrors this exact rule set so the bar
// the user sees always matches what the server will actually accept).
// Score 0-4: length>=8, lowercase, uppercase, number, symbol (one point each,
// capped at 4). Minimum to pass registration: score >= 3 AND length >= 8.
function scorePassword(password) {
    const pw = String(password || '');
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[a-z]/.test(pw)) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 4);
}

function isStrongEnoughPassword(password) {
    const pw = String(password || '');
    return pw.length >= 8 && scorePassword(pw) >= 3;
}

// Trims a string field and turns '' into null (matches the convention
// already used by settingsAdminService.updateProfile for optional columns).
function cleanOptional(value) {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed === '' ? null : trimmed;
}

function isNonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

module.exports = {
    isValidEmail, isValidPhone, scorePassword, isStrongEnoughPassword,
    cleanOptional, isNonEmpty
};
