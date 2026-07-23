const whatsappService = require('../../services/whatsappService');
const sessionManager = require('./sessionManager');
const { sendOptionMenu } = require('./optionMenu');
const M = require('../messages');

const FAILURE_THRESHOLD = 3;

// Centralizes the failure_count escalation the schema defines but the
// blueprint never specified logic for: after repeated invalid replies in the
// same state, bail the user out instead of leaving them stuck retrying
// forever. `onEscalate` is supplied by the caller — usually
// sessionManager.resetToMainMenu, silently, since the M.escalation message
// just sent above is already a complete "let's start over" and immediately
// resending the full greeting behind it read as redundant; the menu still
// shows on the user's next message via index.js's fresh-session check.
//
// On a non-escalating retry, the actual option list is RESENT (not just a
// text nudge) — a user complained they got "reply with a number from the
// list" with no list ever visible in the chat, because the original send had
// silently failed (whatsappService swallows send errors) or they'd returned
// to an old session long after the menu scrolled out of view. headerText/
// options are optional (e.g. patientSelector's NEW_PATIENT_REG free-text state has no list).
async function handleInvalidInput(hospital, phone, headerText, options, retryMessage, onEscalate) {
    const failures = await sessionManager.incrementFailure(phone);

    if (failures >= FAILURE_THRESHOLD) {
        await whatsappService.sendText(hospital, phone, M.escalation);
        await onEscalate();
        return;
    }

    await whatsappService.sendText(hospital, phone, retryMessage);
    if (headerText && options && options.length > 0) {
        await sendOptionMenu(hospital, phone, headerText, options);
    }
}

module.exports = { handleInvalidInput, FAILURE_THRESHOLD };
