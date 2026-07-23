const STATES = require('../states');
const catalogService = require('../../services/catalogService');
const bookingService = require('../../services/bookingService');
const capacityController = require('../capacityController');
const queueAdminService = require('../../services/queueAdminService');
const whatsappService = require('../../services/whatsappService');
const sessionManager = require('../helpers/sessionManager');
const { sendOptionMenu, resolveSelection } = require('../helpers/optionMenu');
const { handleInvalidInput } = require('../helpers/invalidInput');
const M = require('../messages');

// Same doctor, new date/shift — a reschedule never changes doctor, so this
// walks straight into date selection (no branch/dept/doctor steps), mirroring
// bookingFlow.proceedAfterDoctor.
async function startReschedule(hospital, phone, appointmentId, doctorId, patientId) {
    const doctor = await catalogService.getDoctorById(doctorId);
    const availability = await bookingService.getAvailability(doctor, 7, hospital.id);
    const openDates = availability.filter(d => d.totalRemaining > 0);

    if (openDates.length === 0) {
        const next = await bookingService.getNextAvailable(doctor, 21, hospital.id);
        await whatsappService.sendText(hospital, phone, M.fullyBooked(doctor.name, next));
        // Silent reset — the original appointment is untouched; nothing more
        // to say beyond the message just sent.
        await sessionManager.resetToMainMenu(phone);
        return;
    }

    const options = await sendOptionMenu(
        hospital, phone, M.selectDate,
        openDates.map(d => ({
            id: `date_${d.date}`,
            label: M.formatDateDisplay(d.date),
            description: M.dateDescription(d.weekday)
        }))
    );
    await sessionManager.transitionState(phone, STATES.RESCHEDULE_SELECT_DATE, {
        appointment_id: appointmentId, doctor_id: doctorId, patient_id: patientId, options
    });
}

async function handleSelectDate(hospital, phone, session, incoming) {
    const options = session.state_data?.options || [];
    const selected = resolveSelection(options, incoming.text, incoming.interactiveId);
    const { appointment_id: appointmentId, doctor_id: doctorId, patient_id: patientId } = session.state_data || {};

    if (!selected) {
        await handleInvalidInput(
            hospital, phone,
            M.selectDate, options,
            M.invalidDate,
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    const date = selected.id.replace('date_', '');
    const doctor = await catalogService.getDoctorById(doctorId);
    const openShifts = (await bookingService.getShiftsWithCapacity(doctor, date, hospital.id)).filter(s => s.remaining > 0);

    if (openShifts.length === 0) {
        const next = await bookingService.getNextAvailable(doctor, 21, hospital.id);
        await whatsappService.sendText(hospital, phone, M.dateFilledUp(next));
        await sessionManager.resetToMainMenu(phone);
        return;
    }

    const shiftOptions = await sendOptionMenu(
        hospital, phone, M.selectShift,
        openShifts.map(s => ({ id: `shift_${s.shift}`, label: s.shift, labelHi: M.shiftLabelHi(s.shift) }))
    );
    await sessionManager.transitionState(phone, STATES.RESCHEDULE_SELECT_SHIFT, {
        appointment_id: appointmentId, doctor_id: doctorId, patient_id: patientId, date, options: shiftOptions
    });
}

async function handleSelectShift(hospital, phone, session, incoming) {
    const options = session.state_data?.options || [];
    const selected = resolveSelection(options, incoming.text, incoming.interactiveId);
    const { appointment_id: appointmentId, doctor_id: doctorId, patient_id: patientId, date } = session.state_data || {};

    if (!selected) {
        await handleInvalidInput(
            hospital, phone,
            M.selectShift, options,
            M.invalidShift,
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    const shift = selected.id.replace('shift_', '');

    // Re-validate right before asking for final confirmation — same reasoning
    // as selectShift.js's booking-flow counterpart: the list shown a moment
    // ago can go stale (another patient took the last token).
    const capacity = await capacityController.validateShiftCapacity(doctorId, date, shift, hospital.id);
    if (!capacity.available) {
        const doctor = await catalogService.getDoctorById(doctorId);
        const next = await bookingService.getNextAvailable(doctor, 21, hospital.id);
        await whatsappService.sendText(hospital, phone, M.slotJustFilled(next));
        await startReschedule(hospital, phone, appointmentId, doctorId, patientId);
        return;
    }

    const doctor = await catalogService.getDoctorById(doctorId);
    await whatsappService.sendText(hospital, phone, `${M.confirmPrompt}\n\n${M.rescheduleSummary(doctor, date, shift)}`);
    const confirmOptions = await sendOptionMenu(hospital, phone, M.rescheduleConfirmQuestion, M.confirmOptions);
    await sessionManager.transitionState(phone, STATES.RESCHEDULE_CONFIRM, {
        appointment_id: appointmentId, doctor_id: doctorId, patient_id: patientId, date, shift, options: confirmOptions
    });
}

async function handleConfirm(hospital, phone, session, incoming) {
    const options = session.state_data?.options || [];
    const selected = resolveSelection(options, incoming.text, incoming.interactiveId);
    const { appointment_id: appointmentId, doctor_id: doctorId, patient_id: patientId, date, shift } = session.state_data || {};

    if (!selected) {
        await handleInvalidInput(
            hospital, phone,
            M.rescheduleConfirmQuestion, options,
            M.invalidConfirm,
            () => sessionManager.resetToMainMenu(phone)
        );
        return;
    }

    if (selected.id === 'confirm_no') {
        await whatsappService.sendText(hospital, phone, M.rescheduleCancelled);
        await sessionManager.resetToMainMenu(phone);
        return;
    }

    let result;
    try {
        result = await bookingService.createAppointment({ patientId, doctorId, date, shift, hospitalConfig: hospital });
    } catch (err) {
        if (err instanceof bookingService.SlotFullError) {
            // Scenario 9: raced to the last token — same graceful redirect as
            // the original booking flow's confirmBooking.js.
            const doctor = await catalogService.getDoctorById(doctorId);
            const next = await bookingService.getNextAvailable(doctor, 21, hospital.id);
            await whatsappService.sendText(hospital, phone, M.slotJustFilled(next));
            await sessionManager.resetToMainMenu(phone);
            return;
        }
        throw err;
    }

    await bookingService.linkReschedule(appointmentId, result.id);
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

    await whatsappService.sendText(hospital, phone, M.rescheduled(doctor.name, date, shift, result.tokenNumber, result.expectedTime));
    await sessionManager.resetToMainMenu(phone);
}

module.exports = { startReschedule, handleSelectDate, handleSelectShift, handleConfirm };
