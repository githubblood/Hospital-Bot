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
            M.selectDept, options,
            M.invalidDept,
            // Silent reset — see patientSelector.js for why.
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    const deptId = Number(selected.id.replace('dept_', ''));
    const { branch_id: branchId, patient_id: patientId } = session.state_data || {};
    await bookingFlow.proceedAfterDept(hospital, phone, patientId, branchId, deptId);
}

module.exports = { handle };
