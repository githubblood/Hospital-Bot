const STATES = require('../states');
const patientService = require('../../services/patientService');
const whatsappService = require('../../services/whatsappService');
const sessionManager = require('../helpers/sessionManager');
const { sendOptionMenu, resolveSelection } = require('../helpers/optionMenu');
const { handleInvalidInput } = require('../helpers/invalidInput');
const { PATIENT_REG_REGEX } = require('../regex');
const M = require('../messages');

// Multi-Patient Family Booking — entry point for "Book Appointment" (main
// menu option 1, non-walk-in hospitals only; bookingFlow.startBooking calls
// this before touching the branch/dept/doctor catalog at all). Every
// registered family member sharing this WhatsApp number is offered as a
// choice, alongside "New Family Member" to register another one — even when
// there's only one existing patient, per spec: a lone existing patient is
// still a real choice to confirm, never a silently-assumed default.
async function start(hospital, phone) {
    const patients = await patientService.findPatientsByPhone(hospital.id, phone);

    if (patients.length === 0) {
        // Nothing to choose between yet — go straight to registration.
        await promptNewPatient(hospital, phone, M.registerPrompt);
        return;
    }

    const options = patients.map(p => ({ id: `patient_${p.id}`, label: M.patientChoiceLabel(p) }));
    options.push({ ...M.newFamilyMemberOption });

    await sendOptionMenu(hospital, phone, M.choosePatientHeader, options);
    await sessionManager.transitionState(phone, STATES.CHOOSE_PATIENT, { options });
}

async function promptNewPatient(hospital, phone, promptMessage) {
    await whatsappService.sendText(hospital, phone, promptMessage);
    await sessionManager.transitionState(phone, STATES.NEW_PATIENT_REG, {});
}

// STATE_CHOOSE_PATIENT — resolves the reply against the list sent by
// start() above: either an existing family member (jump straight into the
// booking cascade with their patient_id) or "New Family Member" (collect a
// fresh Name/Age/Gender record under the same phone number).
async function handle(hospital, phone, session, incoming) {
    const options = session.state_data?.options || [];
    const selected = resolveSelection(options, incoming.text, incoming.interactiveId);

    if (!selected) {
        await handleInvalidInput(
            hospital, phone,
            M.choosePatientHeader, options,
            M.invalidPatientChoice,
            // Silent reset — see the other handlers in this codebase for why.
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    if (selected.id === M.newFamilyMemberOption.id) {
        await promptNewPatient(hospital, phone, M.addFamilyMemberPrompt);
        return;
    }

    const patientId = Number(selected.id.replace('patient_', ''));
    // Lazy require — bookingFlow.js requires this file back to reach
    // start() above, so requiring it at module scope would create a cycle.
    const bookingFlow = require('./bookingFlow');
    await bookingFlow.proceedWithPatient(hospital, phone, patientId);
}

// STATE_NEW_PATIENT_REG — free-text "Name, Age, Gender", same format/regex
// as the original single-patient registration it replaces. Once created,
// the new family member's id feeds straight into the same booking cascade
// entry point an existing-patient choice would have used.
async function handleNewPatientReg(hospital, phone, session, incoming) {
    const match = (incoming.text || '').trim().match(PATIENT_REG_REGEX);

    if (!match) {
        // No option list here — free-text input, same as the flow it replaces.
        await handleInvalidInput(
            hospital, phone,
            null, null,
            M.registerError,
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    const [, name, age, gender] = match;
    const patient = await patientService.createPatient(hospital.id, phone, name.trim(), parseInt(age, 10), gender.toUpperCase());

    const bookingFlow = require('./bookingFlow');
    await bookingFlow.proceedWithPatient(hospital, phone, patient.id);
}

module.exports = { start, handle, handleNewPatientReg };
