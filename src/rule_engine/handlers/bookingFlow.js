const STATES = require('../states');
const catalogService = require('../../services/catalogService');
const bookingService = require('../../services/bookingService');
const scheduleService = require('../../services/scheduleService');
const whatsappService = require('../../services/whatsappService');
const { sendOptionMenu } = require('../helpers/optionMenu');
const sessionManager = require('../helpers/sessionManager');
const M = require('../messages');

// Implements the "Structural Scenarios" requirement: dynamically walks
// Branch -> Dept -> Doctor -> Date/Time for a multi-specialty chain, or skips
// straight through for a single-doctor clinic, based on the hospital's config
// flags. Each step is skipped (not just hidden) when its flag is off, so a
// single-doctor tenant never even queries branches/departments it doesn't have.

async function startBooking(hospital, phone, session) {
    // Scenario 4 — Walk-in only facility: no booking nodes at all, just an
    // information screen (OPD timings + emergency info). No patient
    // identity is needed here, so this bypasses patient selection entirely.
    if (hospital.walk_in_only) {
        await sendWalkInInfo(hospital, phone);
        // Silent reset — the walk-in info screen is already a complete
        // response; resending the full greeting right behind it read as
        // redundant. The menu still shows next time they type anything.
        await sessionManager.resetToMainMenu(phone);
        return;
    }

    // Multi-Patient Family Booking: figure out WHO the appointment is for
    // before touching the branch/dept/doctor catalog at all — several family
    // members can share one WhatsApp number. patientSelector.js resolves
    // that (existing patient picked, or a new one just registered) and then
    // calls back into proceedWithPatient below to actually start the
    // catalog cascade. Lazy require — patientSelector.js requires this file
    // back to reach proceedWithPatient, same require-cycle guard used
    // throughout this codebase (see selectBranch.js etc.).
    const patientSelector = require('./patientSelector');
    await patientSelector.start(hospital, phone);
}

// Builds and sends the walk-in information screen: OPD timings grouped by
// department, plus emergency info. No live queue feed exists in the data model,
// so "queue status" is represented as the OPD hours to walk in during.
async function sendWalkInInfo(hospital, phone) {
    const doctors = await catalogService.getAllDoctorsForHospital(hospital.id);

    let body = `${M.walkInTitle(hospital.name)}\n`;

    if (doctors.length === 0) {
        body += `\n${M.walkInNoDoctors}`;
    } else {
        let currentDept = null;
        for (const doc of doctors) {
            if (doc.department_name !== currentDept) {
                currentDept = doc.department_name;
                body += `\n📋 ${currentDept}`;
            }
            const timings = scheduleService.formatWeeklyTimings(doc);
            body += `\n• Dr. ${M.cleanDoctorName(doc.name)} (₹${doc.consultation_fee})`;
            body += timings ? `\n${timings.split('\n').map(l => `   ${l}`).join('\n')}` : '';
        }
    }

    if (hospital.emergency_support) {
        body += `\n\n${M.walkInEmergency}`;
    }

    // Guard against WhatsApp's 4096-char text limit for large facilities.
    if (body.length > 3800) {
        body = body.slice(0, 3800) + `\n${M.walkInTruncated}`;
    }

    await whatsappService.sendText(hospital, phone, body);
}

// Real entry point into the branch/dept/doctor cascade once a patient_id has
// been settled — called by patientSelector.js only (never directly by
// mainMenu.js), after either an existing family member was picked or a new
// one was just registered.
async function proceedWithPatient(hospital, phone, patientId) {
    if (hospital.multi_branch) {
        const branches = await catalogService.getActiveBranches(hospital.id);
        if (branches.length === 0) {
            await whatsappService.sendText(hospital, phone, M.noBranches);
            await sessionManager.resetToMainMenu(phone);
            return;
        }
        const options = await sendOptionMenu(hospital, phone, M.selectBranch, branches.map(b => ({ id: `branch_${b.id}`, label: b.name })));
        await sessionManager.transitionState(phone, STATES.SELECT_BRANCH, { patient_id: patientId, options });
        return;
    }

    const branch = await catalogService.getDefaultBranch(hospital.id);
    if (!branch) {
        await whatsappService.sendText(hospital, phone, M.noBranches);
        await sessionManager.resetToMainMenu(phone);
        return;
    }
    await proceedAfterBranch(hospital, phone, patientId, branch.id);
}

async function proceedAfterBranch(hospital, phone, patientId, branchId) {
    if (hospital.multi_dept) {
        const depts = await catalogService.getDepartments(branchId);
        if (depts.length === 0) {
            await whatsappService.sendText(hospital, phone, M.noDepts);
            await sessionManager.resetToMainMenu(phone);
            return;
        }
        // Department names are bilingual in the DB (name_en / name_hi).
        const options = await sendOptionMenu(hospital, phone, M.selectDept,
            depts.map(d => ({ id: `dept_${d.id}`, label: d.name_en, labelHi: d.name_hi })));
        await sessionManager.transitionState(phone, STATES.SELECT_DEPT, { patient_id: patientId, branch_id: branchId, options });
        return;
    }

    const dept = await catalogService.getDefaultDepartment(branchId);
    if (!dept) {
        await whatsappService.sendText(hospital, phone, M.noDepts);
        await sessionManager.resetToMainMenu(phone);
        return;
    }
    await proceedAfterDept(hospital, phone, patientId, branchId, dept.id);
}

async function proceedAfterDept(hospital, phone, patientId, branchId, departmentId) {
    if (hospital.multi_doctor) {
        const doctors = await catalogService.getDoctors(departmentId);
        if (doctors.length === 0) {
            await whatsappService.sendText(hospital, phone, M.noDoctors);
            await sessionManager.resetToMainMenu(phone);
            return;
        }
        const options = await sendOptionMenu(
            hospital, phone, M.selectDoctor,
            doctors.map(d => ({ id: `doctor_${d.id}`, label: `Dr. ${M.cleanDoctorName(d.name)}`, description: M.doctorOptionDescription(d) }))
        );
        await sessionManager.transitionState(phone, STATES.SELECT_DOCTOR, { patient_id: patientId, branch_id: branchId, department_id: departmentId, options });
        return;
    }

    const doctor = await catalogService.getDefaultDoctor(departmentId);
    if (!doctor) {
        await whatsappService.sendText(hospital, phone, M.noDoctors);
        await sessionManager.resetToMainMenu(phone);
        return;
    }
    await proceedAfterDoctor(hospital, phone, patientId, branchId, departmentId, doctor.id);
}

async function proceedAfterDoctor(hospital, phone, patientId, branchId, departmentId, doctorId) {
    const doctor = await catalogService.getDoctorById(doctorId);
    const availability = await bookingService.getAvailability(doctor, 7, hospital.id);
    // Scenario 9: only surface dates that still have at least one free token.
    const openDates = availability.filter(d => d.totalRemaining > 0);

    if (openDates.length === 0) {
        // Every scheduled day in the window is fully booked — look further out.
        const next = await bookingService.getNextAvailable(doctor, 21, hospital.id);
        await whatsappService.sendText(hospital, phone, M.fullyBooked(doctor.name, next));
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
    await sessionManager.transitionState(phone, STATES.SELECT_DATE, {
        patient_id: patientId, branch_id: branchId, department_id: departmentId, doctor_id: doctorId, options
    });
}

module.exports = { startBooking, proceedWithPatient, proceedAfterBranch, proceedAfterDept, proceedAfterDoctor };
