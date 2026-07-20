const STATES = require('../states');
const catalogService = require('../../services/catalogService');
const bookingService = require('../../services/bookingService');
const queueAdminService = require('../../services/queueAdminService');
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
            M.confirmQuestion, options,
            M.invalidBookingConfirm,
            // Silent reset — see the other outcomes in this file for why.
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    if (selected.id === 'confirm_no') {
        await whatsappService.sendText(hospital, phone, M.bookingCancelled);
        // Silent reset — the cancellation message is already a complete
        // outcome; resending the full "Namaste, I'm the assistant..." greeting
        // right after it read as redundant. The menu still shows next time
        // they type anything, via index.js's fresh-session check.
        await sessionManager.resetToMainMenu(phone);
        return;
    }

    const { doctor_id: doctorId, date, shift, patient_id: patientId } = session.state_data || {};

    let result;
    try {
        result = await bookingService.createAppointment({ patientId, doctorId, date, shift, hospitalConfig: hospital });
    } catch (err) {
        if (err instanceof bookingService.SlotFullError) {
            // Scenario 9: raced to the last token — proactively point them at the
            // next open slot rather than just bouncing to the menu.
            const doctor = await catalogService.getDoctorById(doctorId);
            const next = await bookingService.getNextAvailable(doctor, 21);
            await whatsappService.sendText(hospital, phone, M.slotJustFilled(next));
            await sessionManager.resetToMainMenu(phone);
            return;
        }
        throw err;
    }

    // A new token just landed in today's queue — push it to any admin
    // dashboard currently watching this doctor/shift's live queue.
    await queueAdminService.broadcastQueueUpdate(hospital.id, doctorId, shift);

    const doctor = await catalogService.getDoctorById(doctorId);

    if (result.status === 'Pending_Payment') {
        const reminder = M.pendingPayment(doctor.name, date, shift, result.tokenNumber, result.expectedTime, result.consultation_fee);
        await whatsappService.sendText(hospital, phone, reminder);
        await sessionManager.transitionState(phone, STATES.AWAITING_PAYMENT, { reminder });
        return;
    }

    if (result.status === 'Pending') {
        await whatsappService.sendText(hospital, phone, M.pendingApproval(result.tokenNumber, date, shift));
        await sessionManager.resetToMainMenu(phone);
        return;
    }

    await whatsappService.sendText(hospital, phone, M.confirmed(doctor.name, date, shift, result.tokenNumber, result.expectedTime));
    await sessionManager.resetToMainMenu(phone);
}

module.exports = { handle };
