const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// Monday-first, for display purposes only (DAY_KEYS above is Sunday-first to
// match JS Date.getDay()).
const DISPLAY_DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SHIFTS = ['Morning', 'Afternoon', 'Evening'];
const ALLOWED_DURATIONS = [5, 10, 15, 20, 30];

// toISOString() converts to UTC first, which shifts the date back a day
// whenever local time is enough behind UTC-midnight (IST included) — the
// same off-by-one class already fixed for DB-sourced dates via messages.js's
// formatDate(). Read the local Y/M/D components instead, since `date` here is
// always a genuine local Date (new Date() + setDate()), matching how MySQL's
// CURDATE() reflects the server's local date everywhere else in the app.
function toDateOnly(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getWeekdayKey(date) {
    return DAY_KEYS[date.getDay()];
}

// Normalizes whatever's stored on doctors.schedule_json (string or already-
// parsed object) into the admin-controlled Booking Capacity shape — one
// template of working days + shifts applied every working day, not a
// per-weekday grid. See database/schema.sql's comment on this column for the exact
// shape and rationale.
function getScheduleForDoctor(schedule_json) {
    const raw = typeof schedule_json === 'string' ? JSON.parse(schedule_json) : (schedule_json || {});
    return {
        working_days: Array.isArray(raw.working_days) ? raw.working_days : [],
        duration_mins: raw.duration_mins || null,
        shifts: (raw.shifts && typeof raw.shifts === 'object') ? raw.shifts : {}
    };
}

// Returns the shift's {start, end, max_tokens, duration_mins}, or null if the
// doctor doesn't work that weekday or doesn't offer that shift at all.
// duration_mins is copied in from the doctor-level setting so every caller
// that already has a shiftWindow (computeExpectedTime, capacity checks) can
// read it without a second lookup.
function getShiftWindow(doctor, dateStr, shift) {
    const schedule = getScheduleForDoctor(doctor.schedule_json);
    const dayKey = getWeekdayKey(new Date(`${dateStr}T00:00:00`));
    if (!schedule.working_days.includes(dayKey)) return null;
    const shiftConfig = schedule.shifts[shift.toLowerCase()];
    if (!shiftConfig) return null;
    return { ...shiftConfig, duration_mins: schedule.duration_mins };
}

function nowTimeStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function isDoctorAvailable(doctor, dateStr, shift) {
    if (doctor.is_on_leave) return false;
    const window = getShiftWindow(doctor, dateStr, shift);
    if (!window) return false;
    // A shift that has already fully ended today can never be relevant to
    // self-service booking, regardless of token capacity — this is the
    // coarse, booked-count-independent half of the fix; see
    // nextTokenTimeHasPassed below for the precise per-token check used
    // once booked counts are available.
    if (dateStr === toDateOnly(new Date()) && window.end <= nowTimeStr()) return false;
    return true;
}

// Token numbers are always assigned sequentially from the next unclaimed
// number (see bookingService.createAppointment's MAX(token_number)+1), never
// backfilled into an earlier gap — so the *next* token to be assigned is the
// only one that matters for "is this shift still genuinely bookable today".
// If its computed expected_time has already passed, the shift's remaining
// capacity is not honestly offerable via self-service booking, even though
// max_tokens - booked might still be positive (this was the exact bug: a
// patient booking at 12:34 PM was offered "Morning" and confirmed for
// token 1 / 9:00 AM — a time already three-plus hours in the past).
// Only applies to today; a future date has no time-of-day constraint.
function nextTokenTimeHasPassed(shiftWindow, dateStr, bookedCount) {
    if (dateStr !== toDateOnly(new Date())) return false;
    const nextTokenTime = computeExpectedTime(shiftWindow, bookedCount + 1);
    return nextTokenTime <= nowTimeStr();
}

// Next `daysAhead` calendar days (including today) on which the doctor works
// (a configured working day, with at least one shift set up) and is not on leave.
function getAvailableDates(doctor, daysAhead = 7) {
    if (doctor.is_on_leave) return [];
    const schedule = getScheduleForDoctor(doctor.schedule_json);
    if (Object.keys(schedule.shifts).length === 0) return [];

    const results = [];
    const today = new Date();
    for (let i = 0; i < daysAhead; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const dayKey = getWeekdayKey(d);
        if (schedule.working_days.includes(dayKey)) {
            results.push({ date: toDateOnly(d), weekday: dayKey });
        }
    }
    return results;
}

function getAvailableShifts(doctor, dateStr) {
    return SHIFTS.filter(shift => isDoctorAvailable(doctor, dateStr, shift));
}

function addMinutesToTime(startTime, minutes) {
    const [h, m] = startTime.split(':').map(Number);
    const total = h * 60 + m + minutes;
    const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
    const mm = String(total % 60).padStart(2, '0');
    return `${hh}:${mm}:00`;
}

function timeDiffMinutes(start, end) {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
}

// Fixed per-appointment duration (admin-configured, shared across every
// shift) — NOT an even split of the window by max_tokens like the old
// per-weekday model. Token N's expected time = shift start + (N-1) * duration.
function computeExpectedTime(shiftWindow, tokenNumber) {
    return addMinutesToTime(shiftWindow.start, (tokenNumber - 1) * shiftWindow.duration_mins);
}

const DAY_LABELS = {
    monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
    friday: 'Fri', saturday: 'Sat', sunday: 'Sun'
};

// Human-readable OPD timings for a doctor, e.g.
//   "Days: Mon, Tue, Wed, Thu, Fri\nMorning 09:00-13:00\nEvening 17:00-20:00"
// Used by the walk-in info screen (Scenario 4) where there's no booking, just
// "come during these hours".
function formatWeeklyTimings(doctor) {
    const schedule = getScheduleForDoctor(doctor.schedule_json);
    if (schedule.working_days.length === 0 || Object.keys(schedule.shifts).length === 0) return '';

    const daysLabel = DISPLAY_DAY_ORDER
        .filter(day => schedule.working_days.includes(day))
        .map(day => DAY_LABELS[day])
        .join(', ');

    const shiftLines = SHIFTS
        .filter(shift => schedule.shifts[shift.toLowerCase()])
        .map(shift => {
            const cfg = schedule.shifts[shift.toLowerCase()];
            return `${shift} ${cfg.start}-${cfg.end}`;
        });

    return [`Days: ${daysLabel}`, ...shiftLines].join('\n');
}

// Enforces the admin panel's Booking Capacity validation rules (see the
// feature's spec): at least one working day, a selected duration, at least
// one enabled shift, end after start, max patients a positive integer, and —
// the one rule that only exists because duration now drives real token
// timing — max_tokens * duration_mins can never exceed the shift's own
// window (otherwise the last token's expected_time would fall past the
// shift's end). Returns an error string, or null if valid.
function validateSchedule(schedule) {
    if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
        return 'Booking capacity configuration is required.';
    }

    const { working_days, duration_mins, shifts } = schedule;

    if (!Array.isArray(working_days) || working_days.length === 0) {
        return 'Select at least one working day.';
    }
    if (!working_days.every(day => DAY_KEYS.includes(day))) {
        return 'Working days contains an invalid day name.';
    }
    if (!ALLOWED_DURATIONS.includes(Number(duration_mins))) {
        return 'Appointment duration must be selected.';
    }
    if (!shifts || typeof shifts !== 'object' || Array.isArray(shifts)) {
        return 'At least one shift must be configured.';
    }

    const configuredShifts = Object.keys(shifts);
    if (configuredShifts.length === 0) {
        return 'Enable at least one shift (Morning/Afternoon/Evening).';
    }

    const validShiftKeys = SHIFTS.map(s => s.toLowerCase());
    for (const key of configuredShifts) {
        if (!validShiftKeys.includes(key)) {
            return `Unknown shift "${key}".`;
        }
        const cfg = shifts[key];
        if (!cfg || typeof cfg.start !== 'string' || typeof cfg.end !== 'string') {
            return `${key} shift is missing a start/end time.`;
        }
        const windowMinutes = timeDiffMinutes(cfg.start, cfg.end);
        if (windowMinutes <= 0) {
            return `${key} shift's end time must be after its start time.`;
        }
        const maxTokens = Number(cfg.max_tokens);
        if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
            return `${key} shift's maximum patients must be a whole number greater than 0.`;
        }
        if (maxTokens * Number(duration_mins) > windowMinutes) {
            return `${key} shift can't fit ${maxTokens} patients at ${duration_mins} min each in that time window.`;
        }
    }

    return null;
}

module.exports = {
    DAY_KEYS,
    SHIFTS,
    ALLOWED_DURATIONS,
    getWeekdayKey,
    getScheduleForDoctor,
    getShiftWindow,
    isDoctorAvailable,
    getAvailableDates,
    getAvailableShifts,
    computeExpectedTime,
    nextTokenTimeHasPassed,
    timeDiffMinutes,
    formatWeeklyTimings,
    validateSchedule
};
