const STATES = require('../states');
const whatsappService = require('../../services/whatsappService');
const sessionManager = require('../helpers/sessionManager');
const { sendOptionMenu, resolveSelection } = require('../helpers/optionMenu');
const { handleInvalidInput } = require('../helpers/invalidInput');
const queueDiagnostics = require('../queueDiagnostics');
const M = require('../messages');

async function sendMainMenu(hospital, phone) {
    const options = await sendOptionMenu(hospital, phone, M.mainMenuHeader(hospital.name), M.menuOptions);
    await sessionManager.transitionState(phone, STATES.MAIN_MENU, { options });
}

async function handle(hospital, phone, session, incoming) {
    // Lazy require: both of these eventually loop back to sendMainMenu, so
    // requiring them at module scope would create a require cycle with this file.
    const bookingFlow = require('./bookingFlow');
    const myAppointments = require('./myAppointments');

    const options = session.state_data?.options || M.menuOptions;
    const selected = resolveSelection(options, incoming.text, incoming.interactiveId);

    if (!selected) {
        await handleInvalidInput(
            hospital, phone,
            M.mainMenuRetryHeader, options,
            M.invalidMainMenu,
            // Silent reset — see the queue-status/help cases below for why.
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    switch (selected.id) {
        case 'main_book':
            await bookingFlow.startBooking(hospital, phone, session);
            break;
        case 'main_my_appts':
            await myAppointments.showAppointments(hospital, phone, session);
            break;
        case 'main_queue_status': {
            const status = await queueDiagnostics.getLiveQueueStatus(hospital, phone);
            await whatsappService.sendText(hospital, phone, status ? `${M.queueStatusHeader}\n\n${status}` : M.noLiveQueueToday);
            // Silent reset — the status/fallback message is already a
            // complete outcome; resending the full "Namaste, I'm the
            // assistant..." greeting right behind it read as redundant. The
            // menu still shows next time they type anything.
            await sessionManager.resetToMainMenu(phone);
            break;
        }
        case 'main_help':
            await whatsappService.sendText(hospital, phone, M.helpText);
            await sessionManager.resetToMainMenu(phone);
            break;
    }
}

module.exports = { sendMainMenu, handle };
