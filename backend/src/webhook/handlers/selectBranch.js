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
            M.selectBranch, options,
            M.invalidBranch,
            // Silent reset — see patientSelector.js for why.
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    const branchId = Number(selected.id.replace('branch_', ''));
    const patientId = session.state_data?.patient_id;
    await bookingFlow.proceedAfterBranch(hospital, phone, patientId, branchId);
}

module.exports = { handle };
