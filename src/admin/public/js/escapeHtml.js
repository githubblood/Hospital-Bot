// Shared XSS guard for every render function that builds innerHTML via
// template-literal interpolation of DB-sourced text (patient/doctor/
// department names, bill notes, etc.). Patient names entered through the
// WhatsApp bot are regex-restricted to letters/spaces, but doctor and
// department names are entered freely through this same admin panel with no
// character restriction — and are then displayed to every other staff
// member at the hospital who views the same lists. Escaping at render time
// (rather than trusting upstream validation) is the correct place to close
// that off, everywhere text meets innerHTML.
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}
