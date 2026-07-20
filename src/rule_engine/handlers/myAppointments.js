const STATES = require('../states');
const patientService = require('../../services/patientService');
const bookingService = require('../../services/bookingService');
const whatsappService = require('../../services/whatsappService');
const sessionManager = require('../helpers/sessionManager');
const queueDiagnostics = require('../queueDiagnostics');
const { sendOptionMenu, resolveSelection } = require('../helpers/optionMenu');
const { handleInvalidInput } = require('../helpers/invalidInput');
const M = require('../messages');

// getUpcomingAppointments is ordered by date/expected_time ASC, so [0] is the
// soonest active (non-cancelled, non-rescheduled-away) appointment.
async function showAppointments(hospital, phone) {
    const patient = await patientService.findPatient(hospital.id, phone);
    if (!patient) {
        await whatsappService.sendText(hospital, phone, M.noAppointmentsYet);
        // Silent reset — see the submenu cases below for why.
        await sessionManager.resetToMainMenu(phone);
        return;
    }

    const appointments = await bookingService.getUpcomingAppointments(patient.id);
    if (appointments.length === 0) {
        await whatsappService.sendText(hospital, phone, M.noUpcoming);
        await sessionManager.resetToMainMenu(phone);
        return;
    }

    const appt = appointments[0];
    await whatsappService.sendText(hospital, phone, M.myAppointmentDetail(hospital, appt));
    await sendSubmenu(hospital, phone, appt.id, appt.doctor_id, patient.id);
}

// Re-sends just the short action submenu — used after "View Queue"/"Contact
// Reception" so the user isn't shown the whole detail card again on every
// sub-action (the double-greeting mistake fixed elsewhere in this codebase).
async function sendSubmenu(hospital, phone, appointmentId, doctorId, patientId) {
    const options = await sendOptionMenu(hospital, phone, M.myAppointmentSubmenuHeader, M.myAppointmentOptions);
    await sessionManager.transitionState(phone, STATES.MY_APPOINTMENTS, {
        appointment_id: appointmentId, doctor_id: doctorId, patient_id: patientId, options
    });
}

async function handle(hospital, phone, session, incoming) {
    const options = session.state_data?.options || [];
    const selected = resolveSelection(options, incoming.text, incoming.interactiveId);
    const { appointment_id: appointmentId, doctor_id: doctorId, patient_id: patientId } = session.state_data || {};

    if (!selected) {
        await handleInvalidInput(
            hospital, phone,
            M.myAppointmentSubmenuHeader, options,
            M.invalidMyAppointmentOption,
            // Silent reset — see the cases below for why.
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    switch (selected.id) {
        case 'appt_view_queue': {
            const status = await queueDiagnostics.getLiveQueueStatus(hospital, phone);
            await whatsappService.sendText(hospital, phone, status ? `${M.queueStatusHeader}\n\n${status}` : M.noLiveQueueToday);
            await sendSubmenu(hospital, phone, appointmentId, doctorId, patientId);
            break;
        }
        case 'appt_reschedule': {
            // Lazy require: avoids a require cycle, symmetric with how
            // mainMenu.js lazy-requires bookingFlow/myAppointments.
            const reschedule = require('./reschedule');
            await reschedule.startReschedule(hospital, phone, appointmentId, doctorId, patientId);
            break;
        }
        case 'appt_cancel': {
            const cancelOptions = await sendOptionMenu(hospital, phone, M.cancelConfirmQuestion, M.confirmOptions);
            await sessionManager.transitionState(phone, STATES.CANCEL_CONFIRM, {
                appointment_id: appointmentId, patient_id: patientId, options: cancelOptions
            });
            break;
        }
        case 'appt_contact':
            await whatsappService.sendText(hospital, phone, M.contactReception(hospital));
            await sendSubmenu(hospital, phone, appointmentId, doctorId, patientId);
            break;
        case 'appt_back':
            // Silent reset — no new outcome to report, just leaving the submenu.
            await sessionManager.resetToMainMenu(phone);
            break;
    }
}

module.exports = { showAppointments, handle };
