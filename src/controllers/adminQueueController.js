const jwt = require('jsonwebtoken');
const queueAdminService = require('../services/queueAdminService');
const queueBroadcastService = require('../services/queueBroadcastService');
const { formatDate } = require('../rule_engine/messages');

function validateQuery(req, res) {
    const { doctor_id, shift } = req.query;
    if (!doctor_id || !['Morning', 'Afternoon', 'Evening'].includes(shift)) {
        res.status(400).json({ error: 'doctor_id and shift (Morning|Afternoon|Evening) are required' });
        return null;
    }
    return { doctorId: doctor_id, shift };
}

exports.getTodayQueue = async (req, res) => {
    const params = validateQuery(req, res);
    if (!params) return;

    const data = await queueAdminService.getTodayQueue(req.admin.hospital_id, params.doctorId, params.shift);
    if (!data) {
        return res.status(404).json({ error: 'Doctor not found' });
    }
    res.json({ data });
};

exports.getLiveStats = async (req, res) => {
    const params = validateQuery(req, res);
    if (!params) return;

    const data = await queueAdminService.getLiveStats(req.admin.hospital_id, params.doctorId, params.shift);
    if (!data) {
        return res.status(404).json({ error: 'Doctor not found' });
    }
    res.json({ data });
};

// All doctors' queues at once, for the Queue Management page. Defaults to
// today (same IST-safe formatDate used throughout, not a JS toISOString()).
exports.getAllQueues = async (req, res) => {
    const date = req.query.date || formatDate(new Date());
    const queues = await queueAdminService.getAllQueuesForDate(req.admin.hospital_id, date);
    res.json({ date, queues });
};

exports.moveToNext = async (req, res) => {
    const appointmentId = req.body && req.body.appointment_id;
    if (!appointmentId) {
        return res.status(400).json({ error: 'appointment_id is required' });
    }

    const result = await queueAdminService.markCurrentDone(req.admin.hospital_id, appointmentId, req.admin.id);
    if (!result) {
        return res.status(404).json({ error: 'No active (non-completed, non-cancelled) appointment found with that id' });
    }
    res.json({ success: true, ...result });
};

// GET /api/admin/queue/stream?doctor_id=&shift=&token=
// A regular jwtAuth-protected route won't work here: the browser's native
// EventSource can't set an Authorization header, so this route verifies the
// token from a query param instead of going through the shared middleware.
exports.streamQueue = async (req, res) => {
    let admin;
    try {
        admin = jwt.verify(req.query.token || '', process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const params = validateQuery(req, res);
    if (!params) return;

    const initialData = await queueAdminService.getTodayQueue(admin.hospital_id, params.doctorId, params.shift);
    if (!initialData) {
        return res.status(404).json({ error: 'Doctor not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify(initialData)}\n\n`);

    const unsubscribe = queueBroadcastService.subscribe(admin.hospital_id, params.doctorId, params.shift, res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);

    req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
};
