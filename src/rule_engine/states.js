module.exports = {
    SELECT_LANGUAGE: 'STATE_SELECT_LANGUAGE',
    MAIN_MENU: 'STATE_MAIN_MENU',
    SELECT_BRANCH: 'STATE_SELECT_BRANCH',
    SELECT_DEPT: 'STATE_SELECT_DEPT',
    SELECT_DOCTOR: 'STATE_SELECT_DOCTOR',
    // Multi-Patient Family Booking: asked right after "Book Appointment",
    // before the branch/dept/doctor cascade even starts — see
    // patientSelector.js. Replaces the old STATE_PATIENT_REG, which only
    // registered a patient mid-flow (after date/shift) when none existed yet;
    // patient identity is now always settled up front instead.
    CHOOSE_PATIENT: 'STATE_CHOOSE_PATIENT',
    NEW_PATIENT_REG: 'STATE_NEW_PATIENT_REG',
    SELECT_DATE: 'STATE_SELECT_DATE',
    SELECT_SHIFT: 'STATE_SELECT_SHIFT',
    CONFIRM_BOOKING: 'STATE_CONFIRM_BOOKING',
    AWAITING_PAYMENT: 'STATE_AWAITING_PAYMENT',
    // Repurposed: now the single-appointment detail card's action submenu
    // (view queue/reschedule/cancel/contact/back) rather than a numbered list
    // of all appointments.
    MY_APPOINTMENTS: 'STATE_MY_APPOINTMENTS',
    CANCEL_CONFIRM: 'STATE_CANCEL_CONFIRM',
    RESCHEDULE_SELECT_DATE: 'STATE_RESCHEDULE_SELECT_DATE',
    RESCHEDULE_SELECT_SHIFT: 'STATE_RESCHEDULE_SELECT_SHIFT',
    RESCHEDULE_CONFIRM: 'STATE_RESCHEDULE_CONFIRM'
};
