const bookingService = require('../../services/bookingService');
const whatsappService = require('../../services/whatsappService');
const sessionManager = require('../helpers/sessionManager');
const { resolveSelection } = require('../helpers/optionMenu');
const { handleInvalidInput } = require('../helpers/invalidInput');
const M = require('../messages');

async function handle(hospital, phone, session, incoming) {
    const options = session.state_data?.options || [];
    const selected = resolveSelection(options, incoming.text, incoming.interactiveId);

    if (!selected) {
        await handleInvalidInput(
            hospital, phone,
            M.cancelConfirmQuestion, options,
            M.invalidConfirm,
            // Silent reset — see the outcomes below for why.
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    if (selected.id === 'confirm_no') {
        await whatsappService.sendText(hospital, phone, M.cancelAborted);
        await sessionManager.resetToMainMenu(phone);
        return;
    }

    const { appointment_id: appointmentId, patient_id: patientId } = session.state_data || {};
    const cancelled = await bookingService.cancelAppointment(appointmentId, patientId);

    await whatsappService.sendText(hospital, phone, cancelled ? M.cancelSuccess : M.cancelFail);
    await sessionManager.resetToMainMenu(phone);
}

module.exports = { handle };
