const STATES = require('../states');
const catalogService = require('../../services/catalogService');
const bookingService = require('../../services/bookingService');
const whatsappService = require('../../services/whatsappService');
const sessionManager = require('../helpers/sessionManager');
const { sendOptionMenu, resolveSelection } = require('../helpers/optionMenu');
const { handleInvalidInput } = require('../helpers/invalidInput');
const M = require('../messages');

async function handle(hospital, phone, session, incoming) {
    const options = session.state_data?.options || [];
    const selected = resolveSelection(options, incoming.text, incoming.interactiveId);

    if (!selected) {
        await handleInvalidInput(
            hospital, phone,
            M.selectDate, options,
            M.invalidDate,
            // Silent reset — see the dateFilledUp case below for why.
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    const date = selected.id.replace('date_', '');
    const { branch_id: branchId, department_id: departmentId, doctor_id: doctorId, patient_id: patientId } = session.state_data || {};

    const doctor = await catalogService.getDoctorById(doctorId);
    // Scenario 9: only offer shifts that still have free tokens on this date.
    const openShifts = (await bookingService.getShiftsWithCapacity(doctor, date)).filter(s => s.remaining > 0);

    if (openShifts.length === 0) {
        const next = await bookingService.getNextAvailable(doctor, 21);
        await whatsappService.sendText(hospital, phone, M.dateFilledUp(next));
        // Silent reset — the message is already a complete outcome; resending
        // the full greeting right behind it read as redundant.
        await sessionManager.resetToMainMenu(phone);
        return;
    }

    const shiftOptions = await sendOptionMenu(
        hospital, phone, M.selectShift,
        openShifts.map(s => ({
            id: `shift_${s.shift}`,
            label: s.shift,
            labelHi: M.shiftLabelHi(s.shift)
        }))
    );
    await sessionManager.transitionState(phone, STATES.SELECT_SHIFT, {
        patient_id: patientId, branch_id: branchId, department_id: departmentId, doctor_id: doctorId, date, options: shiftOptions
    });
}

module.exports = { handle };
