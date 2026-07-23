const STATES = require('./states');
const { EMERGENCY_REGEX, MENU_RESET_REGEX } = require('./regex');
const { resolveHospitalByPhoneNumberId } = require('./helpers/configLoader');
const sessionManager = require('./helpers/sessionManager');
const langContext = require('./helpers/langContext');
const whatsappService = require('../services/whatsappService');
const db = require('../config/db');
const M = require('./messages');

const mainMenu = require('./handlers/mainMenu');
const selectLanguage = require('./handlers/selectLanguage');
const selectBranch = require('./handlers/selectBranch');
const selectDept = require('./handlers/selectDept');
const selectDoctor = require('./handlers/selectDoctor');
const patientSelector = require('./handlers/patientSelector');
const selectDate = require('./handlers/selectDate');
const selectShift = require('./handlers/selectShift');
const confirmBooking = require('./handlers/confirmBooking');
const awaitingPayment = require('./handlers/awaitingPayment');
const myAppointments = require('./handlers/myAppointments');
const cancelConfirm = require('./handlers/cancelConfirm');
const reschedule = require('./handlers/reschedule');

const STATE_HANDLERS = {
    [STATES.SELECT_LANGUAGE]: selectLanguage.handle,
    [STATES.SELECT_BRANCH]: selectBranch.handle,
    [STATES.SELECT_DEPT]: selectDept.handle,
    [STATES.SELECT_DOCTOR]: selectDoctor.handle,
    [STATES.CHOOSE_PATIENT]: patientSelector.handle,
    [STATES.NEW_PATIENT_REG]: patientSelector.handleNewPatientReg,
    [STATES.SELECT_DATE]: selectDate.handle,
    [STATES.SELECT_SHIFT]: selectShift.handle,
    [STATES.CONFIRM_BOOKING]: confirmBooking.handle,
    [STATES.AWAITING_PAYMENT]: awaitingPayment.handle,
    [STATES.MY_APPOINTMENTS]: myAppointments.handle,
    [STATES.CANCEL_CONFIRM]: cancelConfirm.handle,
    [STATES.RESCHEDULE_SELECT_DATE]: reschedule.handleSelectDate,
    [STATES.RESCHEDULE_SELECT_SHIFT]: reschedule.handleSelectShift,
    [STATES.RESCHEDULE_CONFIRM]: reschedule.handleConfirm
};

// Meta retries webhook delivery if it doesn't get a fast-enough 200, which can
// hand us the same message twice. Dedup by message id so a retry can't
// double-book/double-cancel anything or send a duplicate reply.
//
// Two layers: an in-memory Map is checked first (handles the common case —
// a retry arriving while this same process is still up — with zero DB
// round-trip), then the persisted processed_webhook_messages table (see
// schema.sql) as a backstop for the gap the Map can't cover: a process
// restart (deploy, crash) wipes it, so a retry landing in a fresh process
// would otherwise look brand-new and get processed a second time — the
// literal "bot repeats messages" symptom. INSERT-as-check reuses the same
// insert-then-catch-duplicate-key idiom bookingService.createAppointment
// already uses for token allocation; db.js remaps Postgres' 23505 to
// ER_DUP_ENTRY for exactly this kind of cross-dialect check.
const PROCESSED_MESSAGE_TTL_MS = 10 * 60 * 1000;
const processedMessageIds = new Map();

async function alreadyProcessed(messageId) {
    if (!messageId) return false;

    const now = Date.now();
    for (const [id, ts] of processedMessageIds) {
        if (now - ts > PROCESSED_MESSAGE_TTL_MS) processedMessageIds.delete(id);
    }
    if (processedMessageIds.has(messageId)) return true;
    processedMessageIds.set(messageId, now);

    try {
        await db.query('INSERT INTO processed_webhook_messages (message_id) VALUES (?)', [messageId]);
        return false;
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return true;
        // Fail open — a dedup-table hiccup should never block a real,
        // never-before-seen message from being answered.
        console.error('processed_webhook_messages dedup check failed:', err.message || err);
        return false;
    }
}

// A handler's work spans several awaited WhatsApp API calls before the
// session row is finally updated (see e.g. selectShift -> confirm-prompt
// sends -> transitionState). If the same phone sends two messages close
// together (a fast "Yes" right after seeing the confirm prompt is a very
// common case), a second handleIncomingMessage call can start and read the
// session row before the first call has finished writing it, so both act on
// the same stale state and the slower write clobbers the other's progress.
// Queue calls per phone number so a phone's messages are always processed
// one at a time, start to finish, in arrival order.
const phoneQueues = new Map();

function runSerializedForPhone(phone, task) {
    const prev = phoneQueues.get(phone) || Promise.resolve();
    const next = prev.then(task, task).finally(() => {
        if (phoneQueues.get(phone) === next) phoneQueues.delete(phone);
    });
    phoneQueues.set(phone, next);
    return next;
}

// Brand-new session, or an existing one that's never picked a language: ask
// first. Otherwise go straight to the main menu. preferred_language lives on
// its own session column (not state_data), so once set it survives every
// resetToMainMenu/transitionState call — a returning user is never asked twice.
async function sendMainMenuOrAskLanguage(hospital, phone, session) {
    if (!session.preferred_language) {
        await selectLanguage.sendLanguagePrompt(hospital, phone);
        return;
    }
    await mainMenu.sendMainMenu(hospital, phone);
}

async function handleIncomingMessage(userPhone, phoneNumberId, incoming, messageId) {
    if (await alreadyProcessed(messageId)) return;
    return runSerializedForPhone(userPhone, () => processMessage(userPhone, phoneNumberId, incoming));
}

async function processMessage(userPhone, phoneNumberId, incoming) {
    const hospital = await resolveHospitalByPhoneNumberId(phoneNumberId);
    if (!hospital) {
        console.error(`No hospital configured for WhatsApp phone_number_id ${phoneNumberId}`);
        return;
    }
    // A suspended hospital gets a clear, one-time notice instead of either
    // silently no-op'ing (confusing — the patient gets no reply at all) or
    // letting the conversation proceed into a booking flow that would only
    // fail deep inside bookingService.createAppointment with no good
    // patient-facing message. No session state is touched, so nothing about
    // an in-progress conversation is lost if the hospital is reactivated.
    if (hospital.status === 'Suspended') {
        await whatsappService.sendText(hospital, userPhone, M.bi(
            "We're sorry, this hospital's booking service is temporarily unavailable. Please contact the hospital directly for assistance.",
            'क्षमा करें, इस अस्पताल की बुकिंग सेवा अस्थायी रूप से अनुपलब्ध है। कृपया सहायता के लिए सीधे अस्पताल से संपर्क करें।'
        ));
        return;
    }

    // Fetched before anything else (and before entering the language context
    // below) so every message this phone receives — including the emergency/
    // menu-reset overrides — renders in their chosen language, not just the
    // ones generated by their current state's handler.
    const session = await sessionManager.getOrCreateSession(userPhone, hospital.id);

    return langContext.run(session.preferred_language, async () => {
        const textClean = (incoming.text || '').trim().toLowerCase();

        // Global overrides — take priority over whatever state the session is in.
        // Scenario 7: hard-abort the booking pipeline — reset any in-progress
        // session so the emergency response isn't tangled with a half-finished flow.
        if (hospital.emergency_support && EMERGENCY_REGEX.test(textClean)) {
            await whatsappService.sendText(hospital, userPhone, M.emergency);
            await sessionManager.resetToMainMenu(userPhone);
            return;
        }
        if (MENU_RESET_REGEX.test(textClean)) {
            await sessionManager.resetToMainMenu(userPhone);
            await sendMainMenuOrAskLanguage(hospital, userPhone, session);
            return;
        }

        // Brand-new (or just-reset) session: greet instead of trying to
        // interpret their first message as a menu selection.
        if (session.current_state === STATES.MAIN_MENU && !session.state_data) {
            await sendMainMenuOrAskLanguage(hospital, userPhone, session);
            return;
        }

        const handler = session.current_state === STATES.MAIN_MENU
            ? mainMenu.handle
            : STATE_HANDLERS[session.current_state];

        if (!handler) {
            console.error(`Unknown state '${session.current_state}' for ${userPhone}, resetting to main menu`);
            await sessionManager.resetToMainMenu(userPhone);
            await sendMainMenuOrAskLanguage(hospital, userPhone, session);
            return;
        }

        await handler(hospital, userPhone, session, incoming);
    });
}

module.exports = { handleIncomingMessage };
