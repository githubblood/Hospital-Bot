const { resolveSelection } = require('../helpers/optionMenu');
const { handleInvalidInput } = require('../helpers/invalidInput');
const sessionManager = require('../helpers/sessionManager');
const M = require('../messages');

async function handle(hospital, phone, session, incoming) {
    const bookingFlow = require('./bookingFlow');
    const options = session.state_data?.options || [];
    const selected = resolveSelection(options, incoming.text, incoming.interactiveId);

    if (!selected) {
        await handleInvalidInput(
            hospital, phone,
            M.selectDoctor, options,
            M.invalidDoctor,
            // Silent reset — see patientSelector.js for why.
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    const doctorId = Number(selected.id.replace('doctor_', ''));
    const { branch_id: branchId, department_id: departmentId, patient_id: patientId } = session.state_data || {};
    await bookingFlow.proceedAfterDoctor(hospital, phone, patientId, branchId, departmentId, doctorId);
}

module.exports = { handle };
