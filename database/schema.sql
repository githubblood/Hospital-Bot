-- Hospital WhatsApp Chatbot — schema (PostgreSQL / Supabase)
--
-- Migrated from MySQL to Postgres (Supabase) — this file is the live,
-- current schema, not a base-plus-migration-notes history like its MySQL
-- predecessor. Run this once against a fresh Postgres database (e.g. a new
-- Supabase project) to bootstrap everything from scratch, in the order
-- below (each table only references ones already created above it).
--
-- Conventions carried over from the MySQL version:
--   - ENUMs are VARCHAR + CHECK constraints, not native Postgres enum types
--     — avoids the ALTER TYPE ceremony Postgres enums need every time a
--     value is added (this schema has extended several of them more than
--     once already).
--   - JSON-shaped columns (schedule_json, state_data, details, etc.) are
--     TEXT, not JSONB — the app already does JSON.parse/JSON.stringify at
--     every read/write site; JSONB would have `pg` auto-parse into an
--     object and double-parse. A CHECK (`col::jsonb IS NOT NULL`) still
--     validates the text is well-formed JSON without changing the type.
--   - `updated_at` / `status_updated_at` / `last_interaction` columns that
--     were `... ON UPDATE CURRENT_TIMESTAMP` in MySQL are maintained here by
--     a trigger (Postgres has no inline equivalent) — see set_updated_at()
--     and its two column-specific siblings below.
--   - Every actor-tracking FK (created_by, admin_id, changed_by, etc.) is
--     nullable with ON DELETE SET NULL, paired with a plain-text name
--     snapshot column, so an audit/history row still reads correctly after
--     the acting account is deleted — applied consistently everywhere an
--     admin/platform-admin id is referenced.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_status_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.status_updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_last_interaction() RETURNS TRIGGER AS $$
BEGIN
    NEW.last_interaction = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Stage 4C — Subscription & Licensing. A plan is a named bundle of resource
-- limits + module entitlements a platform admin can create/edit/archive.
-- NULL on any max_* column means "unlimited" (the seeded Enterprise plan
-- below) rather than a magic sentinel number — checked directly by
-- subscriptionService.checkLimit. Created before `hospitals` since
-- hospitals.plan_id references it.
CREATE TABLE subscription_plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    max_branches INT NULL,
    max_departments INT NULL,
    max_doctors INT NULL,
    max_staff INT NULL,
    max_monthly_appointments INT NULL,
    max_monthly_whatsapp_conversations INT NULL,
    reports_module BOOLEAN NOT NULL DEFAULT FALSE,
    reception_module BOOLEAN NOT NULL DEFAULT FALSE,
    analytics_module BOOLEAN NOT NULL DEFAULT FALSE,
    api_access BOOLEAN NOT NULL DEFAULT FALSE,
    multi_branch_support BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Archived')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_subscription_plans_updated_at BEFORE UPDATE ON subscription_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- whatsapp_business_phone_id/whatsapp_access_token are nullable because a
-- hospital now exists from the moment of self-registration
-- (hospitalRegistrationService.js), before its admin has configured
-- WhatsApp via Settings. A hospital with a NULL phone_id simply never
-- matches an incoming webhook (resolveHospitalByPhoneNumberId looks up by
-- exact match), and outbound sendText calls fail closed (caught, logged,
-- not thrown) exactly like an expired/invalid token already does — no
-- special-casing needed anywhere else.
CREATE TABLE hospitals (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    whatsapp_business_phone_id VARCHAR(100) NULL UNIQUE,
    whatsapp_access_token VARCHAR(512) NULL,
    multi_branch BOOLEAN DEFAULT FALSE,
    multi_dept BOOLEAN DEFAULT FALSE,
    multi_doctor BOOLEAN DEFAULT FALSE,
    walk_in_only BOOLEAN DEFAULT FALSE,
    approval_required BOOLEAN DEFAULT FALSE,
    payment_required BOOLEAN DEFAULT FALSE,
    emergency_support BOOLEAN DEFAULT TRUE,
    -- Platform-level kill switch. A Suspended hospital's staff can't log
    -- in, Reception is locked out, the WhatsApp bot sends a suspension
    -- notice instead of booking, and bookingService.createAppointment
    -- refuses to create any appointment for it regardless of caller —
    -- enforced at both the login/session boundary and the single shared
    -- booking choke point, not just one surface.
    status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended')),
    -- Subscription (Stage 4C). plan_id NULL means "no plan assigned" —
    -- subscriptionService.checkLimit treats that as unrestricted, so a
    -- hospital never loses functionality until a platform admin explicitly
    -- assigns a plan. subscription_status only ever holds the three
    -- admin-settable base states ('Trial'/'Active'/'Suspended'); 'Grace
    -- Period' and 'Expired' are derived at read time by comparing the
    -- relevant end date against CURRENT_DATE, never stored.
    plan_id INT NULL REFERENCES subscription_plans(id) ON DELETE SET NULL,
    trial_start_date DATE NULL,
    trial_end_date DATE NULL,
    subscription_start DATE NULL,
    subscription_end DATE NULL,
    grace_period_end DATE NULL,
    subscription_status VARCHAR(20) NOT NULL DEFAULT 'Trial' CHECK (subscription_status IN ('Trial', 'Active', 'Suspended')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    -- Admin-panel "Settings > Hospital Info" profile fields, and the
    -- self-registration form (hospitalRegistrationService.js).
    icon VARCHAR(10) DEFAULT '🏥',
    logo VARCHAR(255) NULL,
    address TEXT NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    country VARCHAR(100) DEFAULT 'India',
    pincode VARCHAR(10) NULL,
    phone VARCHAR(20) NULL,
    email VARCHAR(255) NULL,
    website VARCHAR(255) NULL,
    emergency_contact VARCHAR(20) NULL,
    -- Settings > Operating Hours. Unlike doctors.schedule_json (per-doctor,
    -- drives actual token/capacity math), these are the facility's own
    -- hours — saving a change here diffs against existing appointments
    -- (operatingHoursService.previewAffectedAppointments) and can trigger
    -- notify/reschedule/cancel/waitlist, but never constrains what a
    -- doctor can be scheduled for; the two are intentionally independent.
    morning_start TIME DEFAULT '09:00:00',
    morning_end TIME DEFAULT '13:00:00',
    afternoon_start TIME DEFAULT '13:00:00',
    afternoon_end TIME DEFAULT '17:00:00',
    evening_start TIME DEFAULT '17:00:00',
    evening_end TIME DEFAULT '20:00:00'
);
CREATE INDEX idx_hospitals_plan ON hospitals(plan_id);
CREATE TRIGGER trg_hospitals_updated_at BEFORE UPDATE ON hospitals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Stage 4A — Platform Super Admin Foundation. A completely separate
-- identity from admin_users on purpose: platform_admins has no hospital_id
-- (a platform operator doesn't belong to any one tenant) and no role
-- column (every row here already means the same single "Platform Super
-- Admin" access level — there's nothing to rank). No public
-- self-registration route exists; the first row is created once via
-- scripts/createPlatformAdmin.js.
CREATE TABLE platform_admins (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_platform_admins_updated_at BEFORE UPDATE ON platform_admins
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- address/phone/email back the admin panel's Branches management page.
-- Nullable at the DB level (a migrated pre-existing branch row may have
-- none of these) — "required" is enforced at the application layer for
-- new creates/updates going forward. is_active is read directly by the
-- WhatsApp bot (catalogService.getActiveBranches/getDefaultBranch); the
-- admin UI's "status" (Active/Inactive) label is derived from this same
-- column, not a second source of truth.
CREATE TABLE branches (
    id SERIAL PRIMARY KEY,
    hospital_id INT NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT NULL,
    phone VARCHAR(20) NULL,
    email VARCHAR(255) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_branches_hospital ON branches(hospital_id);
CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON branches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- name_en/name_hi/branch_id are read directly by the WhatsApp bot's
-- bilingual department picker (bookingFlow.js via
-- catalogService.getDepartments). status (Active/Inactive, i.e.
-- "archived") is deliberately NOT enforced in the bot's own department
-- picker — that's booking logic, out of scope for the admin CRUD module
-- that added this column.
CREATE TABLE departments (
    id SERIAL PRIMARY KEY,
    branch_id INT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    name_en VARCHAR(255) NOT NULL,
    name_hi VARCHAR(255) NOT NULL,
    description TEXT NULL,
    display_order INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_departments_branch ON departments(branch_id);
CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON departments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- doctors.schedule_json shape (admin-controlled Booking Capacity, one
-- template applied on every working day — NOT per-weekday customization;
-- a doctor can't have Monday differ from Tuesday, only "works this day or
-- doesn't"):
-- {
--   "working_days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
--   "duration_mins": 15,
--   "shifts": {
--     "morning":   { "start": "09:00", "end": "13:00", "max_tokens": 25 },
--     "afternoon": { "start": "14:00", "end": "17:00", "max_tokens": 20 },
--     "evening":   { "start": "18:00", "end": "20:00", "max_tokens": 15 }
--   }
-- }
-- A missing shift key means the doctor doesn't offer that shift at all.
-- `duration_mins` (one of 5/10/15/20/30) is shared across every configured
-- shift and drives each token's expected_time directly (start +
-- (token-1) * duration_mins) — validated at save time
-- (doctorAdminService.js via scheduleService.validateSchedule) so
-- max_tokens * duration_mins can never exceed a shift's own window.
CREATE TABLE doctors (
    id SERIAL PRIMARY KEY,
    department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    -- Display-only profile fields (admin panel Doctors page) — not read by
    -- any booking/availability logic, same category as hospitals.icon etc.
    qualification VARCHAR(255) NULL,
    experience_years INT DEFAULT 0,
    is_on_leave BOOLEAN DEFAULT FALSE,
    consultation_fee DECIMAL(10, 2) DEFAULT 0.00,
    schedule_json TEXT NOT NULL CHECK (schedule_json::jsonb IS NOT NULL)
);
CREATE INDEX idx_doctors_department ON doctors(department_id);

-- Multi-Patient Family Booking: several family members can share one
-- WhatsApp number under the same hospital (patientSelector.js), so
-- idx_hospital_phone is a plain lookup index, not a uniqueness constraint.
-- A "primary" patient for the handful of call sites that still assume one
-- patient per phone (My Appointments, Live Queue Status, self-service
-- cancel) is resolved deterministically as the first-ever registered row —
-- see patientService.findPatient. uhid is generated once, in the single
-- shared patientService.createPatient (bot registration and Reception's
-- own patient creation both go through it).
CREATE TABLE patients (
    id SERIAL PRIMARY KEY,
    uhid VARCHAR(20) NULL UNIQUE,
    hospital_id INT NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    age INT NOT NULL,
    gender VARCHAR(1) NOT NULL CHECK (gender IN ('M', 'F', 'O')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_hospital_phone ON patients(hospital_id, phone_number);

-- Admin panel staff accounts (JWT login), one hospital per staff account.
-- role is a display-only label for the sidebar's profile card AND the
-- basis for requireRole's rank check (Receptionist=1, Hospital
-- Administrator=2, Super Admin=3). phone_number + reset_code/
-- reset_code_expires_at power the "Forgot Password" flow: a 6-digit OTP
-- delivered over WhatsApp (the only messaging channel this project has).
-- reset_failed_attempts/reset_locked_until are brute-force hardening for
-- that OTP — counts consecutive wrong guesses since the last successful
-- reset (not reset by requesting a fresh OTP, or lockout could be
-- bypassed by simply calling forgot-password again).
CREATE TABLE admin_users (
    id SERIAL PRIMARY KEY,
    hospital_id INT NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'Hospital Administrator' CHECK (role IN ('Hospital Administrator', 'Receptionist', 'Super Admin')),
    phone_number VARCHAR(20) NULL,
    reset_code VARCHAR(10) NULL,
    reset_code_expires_at TIMESTAMP NULL,
    reset_failed_attempts INT NOT NULL DEFAULT 0,
    reset_locked_until TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_admin_users_hospital ON admin_users(hospital_id);
CREATE TRIGGER trg_admin_users_updated_at BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- WhatsApp bot conversation state, one row per phone number (keyed by
-- phone_number directly — a number can only ever be mid-conversation with
-- one hospital at a time; see sessionManager.getOrCreateSession's handling
-- of a number messaging a different hospital's WABA number than the one on
-- record). preferred_language lives on its own column (not inside
-- state_data) specifically so it survives every transitionState/
-- resetToMainMenu call, which replace state_data wholesale.
CREATE TABLE user_sessions (
    phone_number VARCHAR(20) PRIMARY KEY,
    hospital_id INT NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
    current_state VARCHAR(50) NOT NULL DEFAULT 'STATE_MAIN_MENU',
    state_data TEXT NULL CHECK (state_data IS NULL OR state_data::jsonb IS NOT NULL),
    failure_count INT DEFAULT 0,
    last_interaction TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    preferred_language VARCHAR(2) NULL CHECK (preferred_language IS NULL OR preferred_language IN ('en', 'hi'))
);
CREATE INDEX idx_user_sessions_hospital ON user_sessions(hospital_id);
CREATE TRIGGER trg_user_sessions_last_interaction BEFORE UPDATE ON user_sessions
    FOR EACH ROW EXECUTE FUNCTION set_last_interaction();

-- Persisted webhook-message dedup backstop (webhook/index.js's
-- alreadyProcessed). The in-memory Map there handles the common case cheaply,
-- but it's wiped on every process restart (deploy, crash) — if Meta retries
-- delivery of a message across that gap, a fresh process has no memory of
-- having already processed it and would reply/act on it a second time. This
-- table survives restarts; a row is inserted (not merely checked) the first
-- time a message id is seen, and the resulting duplicate-key error on a
-- retry IS the "already processed" signal — same insert-then-catch idiom
-- bookingService.createAppointment already uses for token allocation.
-- Rows are pruned periodically (schedulerService) well past Meta's real
-- retry window, so this never grows unbounded.
CREATE TABLE processed_webhook_messages (
    message_id VARCHAR(255) PRIMARY KEY,
    processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE appointments (
    id SERIAL PRIMARY KEY,
    patient_id INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id INT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    appointment_date DATE NOT NULL,
    shift VARCHAR(20) NOT NULL CHECK (shift IN ('Morning', 'Afternoon', 'Evening')),
    token_number INT NOT NULL,
    expected_time TIME NOT NULL,
    -- 'Waitlisted': set by rescheduleService when an emergency-override/
    -- hours change strands this appointment and no doctor in the
    -- department has a near-term opening either — the old row stays as
    -- history, paired with a waiting_list row that tracks the active
    -- search separately. 'No Show' (Reception Panel): a Confirmed
    -- appointment the patient never arrived for — manually marked by
    -- reception staff, not an automatic sweep.
    status VARCHAR(30) DEFAULT 'Confirmed' CHECK (status IN ('Pending', 'Confirmed', 'Cancelled', 'Completed', 'Pending_Payment', 'Rescheduled', 'Waitlisted', 'No Show')),
    -- The pre-terminal front-desk sub-workflow, orthogonal to `status`
    -- above (which stays 'Confirmed' throughout) — only meaningful while
    -- status is 'Confirmed'; left at whatever it last was once status
    -- goes terminal.
    checkin_status VARCHAR(20) NOT NULL DEFAULT 'Waiting' CHECK (checkin_status IN ('Waiting', 'Checked In', 'In Consultation')),
    checked_in_at TIMESTAMP NULL,
    checked_in_by INT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    -- WhatsApp is the default so a migrated pre-Reception row keeps its
    -- true origin; Reception's manual-booking vs. walk-in-registration
    -- paths set 'Reception'/'Walk-in' respectively.
    booking_source VARCHAR(20) NOT NULL DEFAULT 'WhatsApp' CHECK (booking_source IN ('WhatsApp', 'Reception', 'Walk-in')),
    payment_status VARCHAR(20) DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid', 'Pending', 'Paid')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Set when the live queue dashboard marks a token as seen
    -- (status -> 'Completed'). No separate is_completed boolean — status
    -- already has a 'Completed' value.
    completed_at TIMESTAMP NULL,
    -- Set by schedulerService's reminder worker once the pre-appointment
    -- WhatsApp nudge goes out, so the 15-minute scan never double-sends it.
    reminder_sent BOOLEAN DEFAULT FALSE,
    reminder_sent_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    cancel_reason VARCHAR(255) NULL,
    -- NULL when the patient self-cancels via WhatsApp; set when
    -- Reception/admin cancels on their behalf.
    cancelled_by INT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    -- Reschedule creates a NEW row rather than mutating the old one, so the
    -- original token/date/time stay in the record — this pair links the
    -- two: the old row gets rescheduled_to, the new row gets
    -- rescheduled_from.
    rescheduled_from INT NULL REFERENCES appointments(id) ON DELETE SET NULL,
    rescheduled_to INT NULL REFERENCES appointments(id) ON DELETE SET NULL,
    status_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Guards token allocation against concurrent double-booking of the same slot.
    UNIQUE (doctor_id, appointment_date, shift, token_number)
);
CREATE INDEX idx_appointments_patient ON appointments(patient_id);
CREATE INDEX idx_doctor_date_shift ON appointments(doctor_id, appointment_date, shift);
-- Standalone from idx_doctor_date_shift above — every hospital-wide,
-- date-scoped query that doesn't also filter by doctor_id (dashboard
-- stats, live queue-for-date, every Reports & Analytics query) needs its
-- own usable index on appointment_date.
CREATE INDEX idx_appointment_date ON appointments(appointment_date);
CREATE INDEX idx_appt_resched_from ON appointments(rescheduled_from);
CREATE INDEX idx_appt_resched_to ON appointments(rescheduled_to);
CREATE INDEX idx_appt_checked_in_by ON appointments(checked_in_by);
CREATE INDEX idx_appt_cancelled_by ON appointments(cancelled_by);
CREATE TRIGGER trg_appointments_status_updated_at BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION set_status_updated_at();

-- Reception Panel status/check-in audit trail. changed_by_name is a
-- snapshot (not just a FK) so the record still reads correctly if the
-- admin account is later renamed or deleted.
CREATE TABLE appointment_status_history (
    id SERIAL PRIMARY KEY,
    appointment_id INT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    from_status VARCHAR(30) NULL,
    to_status VARCHAR(30) NOT NULL,
    changed_by INT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    changed_by_name VARCHAR(255) NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ash_appointment ON appointment_status_history(appointment_id);
CREATE INDEX idx_ash_changed_by ON appointment_status_history(changed_by);

-- Billing. No hospital_id column here — every other admin-panel table in
-- this schema derives hospital scoping via patient_id -> patients.hospital_id
-- rather than storing it redundantly on the child row; bills follows that
-- same convention.
CREATE TABLE bills (
    id SERIAL PRIMARY KEY,
    appointment_id INT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    patient_id INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id INT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    consultation_fee DECIMAL(10, 2) DEFAULT 0.00,
    medicine_charges DECIMAL(10, 2) DEFAULT 0.00,
    test_charges DECIMAL(10, 2) DEFAULT 0.00,
    other_charges DECIMAL(10, 2) DEFAULT 0.00,
    discount DECIMAL(10, 2) DEFAULT 0.00,
    total_amount DECIMAL(10, 2) DEFAULT 0.00,
    payment_method VARCHAR(20) DEFAULT 'Cash' CHECK (payment_method IN ('Cash', 'UPI', 'Card', 'Online')),
    payment_status VARCHAR(20) DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid', 'Paid', 'Partial')),
    bill_date DATE NOT NULL,
    paid_at TIMESTAMP NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- One bill per appointment/visit.
    UNIQUE (appointment_id)
);
CREATE INDEX idx_bills_patient ON bills(patient_id);
CREATE INDEX idx_bills_doctor ON bills(doctor_id);

-- Emergency Schedule Override (Settings > Emergency Override). A
-- hospital-wide or single-shift closure the booking engine actually
-- enforces (scheduleOverrideService.isClosed, checked from
-- bookingService.createAppointment, capacityController.validateShiftCapacity,
-- and bookingService's availability functions) — not just an
-- administrative note. Open-ended by design: Maintenance/Power Failure
-- don't have a knowable end time up front, so a closure stays Active
-- until an admin explicitly lifts it.
CREATE TABLE schedule_overrides (
    id SERIAL PRIMARY KEY,
    hospital_id INT NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
    scope VARCHAR(20) NOT NULL CHECK (scope IN ('Morning', 'Afternoon', 'Evening', 'Hospital')),
    reason VARCHAR(30) NOT NULL CHECK (reason IN ('Doctor Emergency', 'Hospital Emergency', 'Public Holiday', 'Maintenance', 'Power Failure', 'Other')),
    note VARCHAR(500) NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Lifted')),
    created_by INT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lifted_by INT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    lifted_at TIMESTAMP NULL
);
CREATE INDEX idx_hospital_status_dates ON schedule_overrides(hospital_id, status, start_date, end_date);
CREATE INDEX idx_schedule_overrides_created_by ON schedule_overrides(created_by);
CREATE INDEX idx_schedule_overrides_lifted_by ON schedule_overrides(lifted_by);

-- Permanent record of every operating-hours change and emergency-override
-- create/lift (Settings > Audit Log) — distinct from the derived, read-time
-- "Recent Activity" topbar dropdown (adminActivityService.js), which has
-- no persistence. admin_name is a snapshot for the same reason every other
-- actor-name column in this schema is one.
CREATE TABLE schedule_audit_log (
    id SERIAL PRIMARY KEY,
    hospital_id INT NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
    admin_id INT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    admin_name VARCHAR(255) NOT NULL,
    change_type VARCHAR(30) NOT NULL CHECK (change_type IN ('OperatingHours', 'EmergencyOverrideCreated', 'EmergencyOverrideLifted')),
    previous_hours TEXT NULL CHECK (previous_hours IS NULL OR previous_hours::jsonb IS NOT NULL),
    updated_hours TEXT NULL CHECK (updated_hours IS NULL OR updated_hours::jsonb IS NOT NULL),
    override_id INT NULL REFERENCES schedule_overrides(id) ON DELETE SET NULL,
    affected_appointments_count INT NOT NULL DEFAULT 0,
    action_taken VARCHAR(30) NOT NULL CHECK (action_taken IN ('KeepExisting', 'Reschedule', 'CancelAppointments', 'ChangesCancelled', 'OverrideCreated', 'OverrideLifted')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_schedule_audit_hospital_created ON schedule_audit_log(hospital_id, created_at);
CREATE INDEX idx_schedule_audit_admin ON schedule_audit_log(admin_id);
CREATE INDEX idx_schedule_audit_override ON schedule_audit_log(override_id);

-- Patients bumped by an hours change or emergency override who couldn't be
-- auto-rescheduled (same doctor, then same-department any doctor — both
-- exhausted). The bumped appointment itself is kept as history with
-- status='Waitlisted'; this row tracks the active search and, once
-- resolved, points at the new appointment it became.
CREATE TABLE waiting_list (
    id SERIAL PRIMARY KEY,
    patient_id INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id INT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    original_appointment_id INT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    preferred_date DATE NOT NULL,
    shift VARCHAR(20) NOT NULL CHECK (shift IN ('Morning', 'Afternoon', 'Evening')),
    status VARCHAR(20) NOT NULL DEFAULT 'Waiting' CHECK (status IN ('Waiting', 'Booked', 'Cancelled')),
    resulting_appointment_id INT NULL REFERENCES appointments(id) ON DELETE SET NULL,
    -- Set only when this row was created by rescheduleService.waitlist() as
    -- part of an emergency override closing a shift/hospital (NULL for the
    -- unrelated operating-hours-change caller of the same function). Lets
    -- scheduleController.liftOverride/waitlistService.notifyStillWaitingForOverride
    -- notify exactly the patients THIS override stranded, not every
    -- hospital-wide waiting patient (some of whom may be stuck on a
    -- different, still-active override).
    caused_by_override_id INT NULL REFERENCES schedule_overrides(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL
);
CREATE INDEX idx_waiting_list_patient ON waiting_list(patient_id);
CREATE INDEX idx_waiting_list_original ON waiting_list(original_appointment_id);
CREATE INDEX idx_waiting_list_resulting ON waiting_list(resulting_appointment_id);
CREATE INDEX idx_doctor_status ON waiting_list(doctor_id, status);
CREATE INDEX idx_waiting_list_override ON waiting_list(caused_by_override_id);

-- Orphaned from an earlier, abandoned attempt at the same feature
-- waiting_list now implements — kept only for schema parity with existing
-- deployments; always empty, zero code references. Safe to drop in a
-- future cleanup pass.
CREATE TABLE waitlist (
    id SERIAL PRIMARY KEY,
    patient_id INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id INT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    preferred_date DATE NOT NULL,
    shift VARCHAR(20) CHECK (shift IN ('Morning', 'Evening')),
    status VARCHAR(20) DEFAULT 'Waiting' CHECK (status IN ('Waiting', 'Notified', 'Booked', 'Expired')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_waitlist_patient ON waitlist(patient_id);
CREATE INDEX idx_waitlist_doctor_date ON waitlist(doctor_id, preferred_date);

-- Append-only log of every forgot-password/reset-password attempt — a
-- companion to admin_users' live lockout counter, so a suspicious pattern
-- of failures can be reviewed after the fact even once
-- reset_failed_attempts itself has been cleared by a later successful
-- reset. admin_user_id is nullable since a failed attempt against an email
-- that doesn't correspond to any account is still worth logging
-- (email_attempted keeps that case readable).
CREATE TABLE password_reset_audit (
    id SERIAL PRIMARY KEY,
    admin_user_id INT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    email_attempted VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('OTP_REQUESTED', 'RESET_SUCCESS', 'RESET_FAILED', 'LOCKED_OUT')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_password_reset_admin ON password_reset_audit(admin_user_id);

-- Append-only record of every platform-level action (hospital created/
-- edited/suspended/activated, plus login events) — the platform-side
-- counterpart to schedule_audit_log, same snapshot-name-not-just-FK
-- reasoning. actor_type/actor_name/{platform,hospital}_admin_id generalize
-- this table to log actions by EITHER identity: a platform admin acting on
-- a hospital (platform_admin_id set, hospital_admin_id null), or a
-- hospital admin's own login (hospital_admin_id set, platform_admin_id
-- null) — exactly one of the two FKs is populated per row, matching
-- actor_type. session_id is a random UUID minted into the JWT at login
-- time purely for audit-trail correlation — this app's JWTs are otherwise
-- fully stateless, no server-side session store.
CREATE TABLE platform_audit_log (
    id SERIAL PRIMARY KEY,
    actor_type VARCHAR(20) NOT NULL DEFAULT 'PlatformAdmin' CHECK (actor_type IN ('PlatformAdmin', 'HospitalAdmin')),
    platform_admin_id INT NULL REFERENCES platform_admins(id) ON DELETE SET NULL,
    hospital_admin_id INT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    actor_name VARCHAR(255) NULL,
    action_type VARCHAR(30) NOT NULL CHECK (action_type IN ('HospitalCreated', 'HospitalEdited', 'HospitalSuspended', 'HospitalActivated', 'HospitalAdminLogin', 'PlatformLogin')),
    hospital_id INT NULL REFERENCES hospitals(id) ON DELETE SET NULL,
    hospital_name VARCHAR(255) NULL,
    details TEXT NULL CHECK (details IS NULL OR details::jsonb IS NOT NULL),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    session_id VARCHAR(64) NULL
);
CREATE INDEX idx_platform_audit_admin ON platform_audit_log(platform_admin_id);
CREATE INDEX idx_platform_audit_hospital_created ON platform_audit_log(hospital_id, created_at);
CREATE INDEX idx_platform_audit_hospital_admin ON platform_audit_log(hospital_admin_id);

-- Separate from platform_audit_log rather than extending its action_type
-- — subscription events get their own append-only log instead of an ALTER
-- on that already-established table. Same conventions throughout:
-- nullable actor FK + name snapshot, SET NULL everywhere, same
-- ip/user-agent/session_id capture.
CREATE TABLE subscription_audit_log (
    id SERIAL PRIMARY KEY,
    platform_admin_id INT NULL REFERENCES platform_admins(id) ON DELETE SET NULL,
    actor_name VARCHAR(255) NULL,
    action_type VARCHAR(30) NOT NULL CHECK (action_type IN (
        'PlanCreated', 'PlanUpdated', 'PlanArchived', 'PlanRestored',
        'PlanAssigned', 'PlanChanged', 'TrialExtended',
        'SubscriptionActivated', 'SubscriptionSuspended', 'SubscriptionReactivated'
    )),
    hospital_id INT NULL REFERENCES hospitals(id) ON DELETE SET NULL,
    hospital_name VARCHAR(255) NULL,
    plan_id INT NULL REFERENCES subscription_plans(id) ON DELETE SET NULL,
    plan_name VARCHAR(100) NULL,
    details TEXT NULL CHECK (details IS NULL OR details::jsonb IS NOT NULL),
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    session_id VARCHAR(64) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_sub_audit_admin ON subscription_audit_log(platform_admin_id);
CREATE INDEX idx_sub_audit_plan ON subscription_audit_log(plan_id);
CREATE INDEX idx_sub_audit_hospital_created ON subscription_audit_log(hospital_id, created_at);

-- Five starter plans (platform admin can edit/archive/create more via the
-- Plan Management UI) — NULL limits on Enterprise mean unlimited.
INSERT INTO subscription_plans
    (name, max_branches, max_departments, max_doctors, max_staff, max_monthly_appointments, max_monthly_whatsapp_conversations, reports_module, reception_module, analytics_module, api_access, multi_branch_support)
VALUES
    ('Free', 1, 2, 2, 2, 50, 100, FALSE, TRUE, FALSE, FALSE, FALSE),
    ('Trial', 1, 5, 5, 5, 200, 500, TRUE, TRUE, TRUE, FALSE, FALSE),
    ('Basic', 1, 10, 10, 10, 500, 1000, TRUE, TRUE, TRUE, FALSE, FALSE),
    ('Professional', 3, 25, 25, 25, 2000, 5000, TRUE, TRUE, TRUE, TRUE, TRUE),
    ('Enterprise', NULL, NULL, NULL, NULL, NULL, NULL, TRUE, TRUE, TRUE, TRUE, TRUE);
