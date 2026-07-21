const STATES = require('../states');
const catalogService = require('../../services/catalogService');
const bookingService = require('../../services/bookingService');
const whatsappService = require('../../services/whatsappService');
const sessionManager = require('../helpers/sessionManager');
const { sendOptionMenu, resolveSelection } = require('../helpers/optionMenu');
const { handleInvalidInput } = require('../helpers/invalidInput');
const capacityController = require('../capacityController');
const bookingFlow = require('./bookingFlow');
const M = require('../messages');

// Patient identity is already settled by this point — resolved up front by
// patientSelector.js before the branch/dept/doctor cascade even started
// (Multi-Patient Family Booking) — so this goes straight to the booking
// summary + Yes/No confirm. No more inline "register if none exists" branch;
// that's now handled entirely by STATE_NEW_PATIENT_REG before booking begins.
async function goToConfirm(hospital, phone, patientId, doctorId, date, shift) {
    const doctor = await catalogService.getDoctorById(doctorId);
    const header = `${M.appointmentSummaryTitle}\n\n${M.bookingSummary(doctor, date, shift)}\n\n${M.confirmQuestion}`;
    const options = await sendOptionMenu(hospital, phone, header, M.bookingConfirmOptions);
    await sessionManager.transitionState(phone, STATES.CONFIRM_BOOKING, {
        doctor_id: doctorId, date, shift, patient_id: patientId, options
    });
}

async function handle(hospital, phone, session, incoming) {
    const options = session.state_data?.options || [];
    const selected = resolveSelection(options, incoming.text, incoming.interactiveId);

    if (!selected) {
        await handleInvalidInput(
            hospital, phone,
            M.selectShift, options,
            M.invalidShift,
            // Silent reset — see the capacity-check redirect below for why.
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    const shift = selected.id.replace('shift_', '');
    const { branch_id: branchId, department_id: departmentId, doctor_id: doctorId, date, patient_id: patientId } = session.state_data || {};

    // Re-validate right before committing to this shift — the list shown a
    // moment ago can go stale (another patient took the last token, or the
    // doctor just went on leave). Catching it here, before the confirm step,
    // is friendlier than only finding out there; bookingService.createAppointment's
    // own transaction is still the real source of truth against a genuine
    // last-token race.
    const capacity = await capacityController.validateShiftCapacity(doctorId, date, shift, hospital.id);
    if (!capacity.available) {
        const doctor = await catalogService.getDoctorById(doctorId);
        const next = await bookingService.getNextAvailable(doctor, 21, hospital.id);
        await whatsappService.sendText(hospital, phone, M.slotJustFilled(next));
        await bookingFlow.proceedAfterDoctor(hospital, phone, patientId, branchId, departmentId, doctorId);
        return;
    }

    await goToConfirm(hospital, phone, patientId, doctorId, date, shift);
}

module.exports = { handle, goToConfirm };
