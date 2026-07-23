const operatingHoursService = require('../services/operatingHoursService');
const scheduleOverrideService = require('../services/scheduleOverrideService');
const scheduleAuditService = require('../services/scheduleAuditService');
const rescheduleService = require('../services/rescheduleService');
const waitlistService = require('../services/waitlistService');

// ---- Operating Hours ----

exports.getOperatingHours = async (req, res) => {
    const hours = await operatingHoursService.getOperatingHours(req.admin.hospital_id);
    res.json(hours || {});
};

exports.previewOperatingHours = async (req, res) => {
    const validationError = operatingHoursService.validateHours(req.body);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }
    const preview = await operatingHoursService.previewAffectedAppointments(req.admin.hospital_id, req.body);
    res.json(preview);
};

exports.saveOperatingHours = async (req, res) => {
    const { action, ...hours } = req.body || {};
    if (action !== 'abort') {
        const validationError = operatingHoursService.validateHours(hours);
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }
    }
    const result = await operatingHoursService.saveOperatingHours(req.admin.hospital_id, req.admin, hours, action);
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }
    res.json(result);
};

// ---- Emergency Overrides ----
// createOverride/liftOverride orchestrate scheduleOverrideService (the pure
// data layer) together with rescheduleService/waitlistService/
// scheduleAuditService here, one level up — scheduleOverrideService itself
// stays free of that dependency to avoid a require() cycle (bookingService
// already depends on scheduleOverrideService for enforcement; see that
// file's own top-of-file comment).

exports.listOverrides = async (req, res) => {
    const overrides = await scheduleOverrideService.listActiveOverrides(req.admin.hospital_id);
    res.json({ overrides });
};

exports.createOverride = async (req, res) => {
    const { scope, reason, note } = req.body || {};
    const result = await scheduleOverrideService.createOverride(req.admin.hospital_id, req.admin, { scope, reason, note });
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }

    const { override, affected } = result;
    // Parallelized (Stage 3.5 perf review) — previously one sequential
    // reschedule-search-and-book round trip per affected appointment, all
    // inside this one request/response cycle. Safe to run concurrently: each
    // targets its own appointment_id, and bookingService.createAppointment's
    // per-doctor `FOR UPDATE` lock already serializes any two that land on
    // the same doctor, exactly as it does for ordinary concurrent bookings.
    const results = await Promise.all(
        affected.map(appt => rescheduleService.autoRescheduleAppointment(appt, req.admin.hospital_id, `an emergency override (${reason})`, req.admin.id))
    );

    await scheduleAuditService.record({
        hospitalId: req.admin.hospital_id, adminId: req.admin.id, adminName: req.admin.name,
        changeType: 'EmergencyOverrideCreated', overrideId: override.id,
        affectedCount: affected.length, actionTaken: 'OverrideCreated'
    });

    res.status(201).json({ override, affectedCount: affected.length, results });
};

exports.liftOverride = async (req, res) => {
    const result = await scheduleOverrideService.liftOverride(req.admin.hospital_id, req.params.id, req.admin);
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Active override not found' });
    }

    await scheduleAuditService.record({
        hospitalId: req.admin.hospital_id, adminId: req.admin.id, adminName: req.admin.name,
        changeType: 'EmergencyOverrideLifted', overrideId: result.override.id,
        actionTaken: 'OverrideLifted'
    });

    const waitlistCleared = await waitlistService.retryWaitingList(req.admin.hospital_id);
    res.json({ lifted: true, waitlistCleared });
};

// ---- Audit log / Waiting list (read-only) ----

exports.getAuditLog = async (req, res) => {
    const entries = await scheduleAuditService.list(req.admin.hospital_id, { limit: req.query.limit, offset: req.query.offset });
    res.json({ entries });
};

exports.listWaitingList = async (req, res) => {
    const entries = await waitlistService.listWaitingList(req.admin.hospital_id, req.query.status || 'Waiting');
    res.json({ entries });
};
