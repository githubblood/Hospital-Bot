-- Hospital WhatsApp Chatbot — schema
-- Base tables are exactly as specified in the project blueprint.
-- Two additions were required to make the flow actually work end-to-end:
--   1. hospitals.whatsapp_access_token — the blueprint had whatsapp_business_phone_id
--      (the "from" number) but no token to authenticate outbound Graph API calls.
--   2. patients table — appointments.patient_id referenced a table that was never
--      defined in the blueprint.
--
-- NOTE for an existing live database (not a fresh install): this file uses
-- CREATE TABLE IF NOT EXISTS, so it will NOT retroactively apply later column
-- additions/type changes to a table that already exists. The multi-tenant
-- self-registration feature (hospitalRegistrationService.js) requires these
-- changes on top of an older database — run once:
--   ALTER TABLE hospitals
--     MODIFY whatsapp_business_phone_id VARCHAR(100) NULL,
--     MODIFY whatsapp_access_token VARCHAR(512) NULL,
--     ADD COLUMN city VARCHAR(100) NULL AFTER address,
--     ADD COLUMN state VARCHAR(100) NULL AFTER city,
--     ADD COLUMN country VARCHAR(100) NULL DEFAULT 'India' AFTER state,
--     ADD COLUMN pincode VARCHAR(10) NULL AFTER country,
--     ADD COLUMN logo VARCHAR(255) NULL AFTER icon,
--     ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
--   ALTER TABLE admin_users
--     ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
--   ALTER TABLE doctors
--     ADD COLUMN qualification VARCHAR(255) NULL AFTER name,
--     ADD COLUMN experience_years INT NULL DEFAULT 0 AFTER qualification;
--
-- Hospital Settings: Afternoon operating shift + emergency overrides + audit
-- log (schedule_overrides/waiting_list/schedule_audit_log are new tables
-- below, created automatically by CREATE TABLE IF NOT EXISTS — only the
-- column additions to existing tables need a manual ALTER on a live DB):
--   ALTER TABLE hospitals
--     ADD COLUMN afternoon_start TIME DEFAULT '13:00:00' AFTER morning_end,
--     ADD COLUMN afternoon_end   TIME DEFAULT '17:00:00' AFTER afternoon_start;
--   ALTER TABLE appointments
--     MODIFY status ENUM('Pending','Confirmed','Cancelled','Completed','Pending_Payment','Rescheduled','Waitlisted')
--     DEFAULT 'Confirmed';
--
-- Departments admin CRUD module (Stage 1 of the SaaS gap-closure plan):
-- extends the existing branch-scoped departments table rather than replacing
-- it — name_en/name_hi/branch_id are exactly what they were, still required
-- by the WhatsApp bot's bilingual department picker (bookingFlow.js via
-- catalogService.getDepartments). Only new, purely additive columns:
--   ALTER TABLE departments
--     ADD COLUMN description TEXT NULL AFTER name_hi,
--     ADD COLUMN display_order INT NOT NULL DEFAULT 0 AFTER description,
--     ADD COLUMN status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active' AFTER display_order,
--     ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER status,
--     ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
--
-- Branches admin CRUD module (Stage 1, second module): extends the existing
-- branches table — hospital_id/name/is_active are exactly what they were,
-- still read directly by the WhatsApp bot (catalogService.getActiveBranches/
-- getDefaultBranch). Only new, purely additive columns:
--   ALTER TABLE branches
--     ADD COLUMN address TEXT NULL AFTER name,
--     ADD COLUMN phone VARCHAR(20) NULL AFTER address,
--     ADD COLUMN email VARCHAR(255) NULL AFTER phone,
--     ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER is_active,
--     ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
--
-- Reception Panel (Stage 2): patients.uhid is generated once, in the single
-- shared patientService.createPatient (bot registration and Reception's own
-- patient creation both go through it — one generation point). appointments
-- gains checkin_status (the pre-terminal front-desk sub-workflow — Waiting/
-- Checked In/In Consultation — orthogonal to the existing `status` column,
-- which stays the authoritative booking lifecycle) plus 'No Show' as a new
-- terminal `status` value (same category as the existing Completed/Cancelled,
-- extending an ENUM this file has already extended once before for
-- 'Waitlisted'). booking_source distinguishes WhatsApp/Reception/Walk-in
-- without touching how any existing row is interpreted (defaults to
-- 'WhatsApp', so every pre-existing appointment keeps its true origin).
-- appointment_status_history is a new audit-trail table, the same pattern
-- schedule_audit_log already established for a different domain — not a new
-- architecture concept for this codebase.
--   ALTER TABLE patients
--     ADD COLUMN uhid VARCHAR(20) NULL UNIQUE AFTER id;
--   ALTER TABLE appointments
--     MODIFY status ENUM('Pending','Confirmed','Cancelled','Completed','Pending_Payment','Rescheduled','Waitlisted','No Show') DEFAULT 'Confirmed',
--     ADD COLUMN checkin_status ENUM('Waiting','Checked In','In Consultation') NOT NULL DEFAULT 'Waiting' AFTER status,
--     ADD COLUMN checked_in_at TIMESTAMP NULL AFTER checkin_status,
--     ADD COLUMN checked_in_by INT NULL AFTER checked_in_at,
--     ADD COLUMN cancelled_by INT NULL AFTER cancel_reason,
--     ADD COLUMN booking_source ENUM('WhatsApp','Reception','Walk-in') NOT NULL DEFAULT 'WhatsApp' AFTER status_updated_at,
--     ADD CONSTRAINT fk_appt_checked_in_by FOREIGN KEY (checked_in_by) REFERENCES admin_users(id) ON DELETE SET NULL,
--     ADD CONSTRAINT fk_appt_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES admin_users(id) ON DELETE SET NULL;
--   (appointment_status_history is a new CREATE TABLE IF NOT EXISTS, defined below.)
--
-- Stage 3.5 — Critical Security & Multi-Tenant Hardening: hospital
-- suspension (platform-admin groundwork, ahead of the Stage 4 Super Admin
-- UI), password-reset brute-force hardening, a missing hot-path index, and
-- fixing an FK that would have thrown on staff deletion.
--   ALTER TABLE hospitals
--     ADD COLUMN status ENUM('Active','Suspended') NOT NULL DEFAULT 'Active' AFTER emergency_support;
--   ALTER TABLE admin_users
--     ADD COLUMN reset_failed_attempts INT NOT NULL DEFAULT 0 AFTER reset_code_expires_at,
--     ADD COLUMN reset_locked_until TIMESTAMP NULL AFTER reset_failed_attempts;
--   ALTER TABLE appointments
--     ADD INDEX idx_appointment_date (appointment_date);
--   -- schedule_overrides.created_by / schedule_audit_log.admin_id were
--   -- ON DELETE RESTRICT, which conflicts with staffAdminService.deleteStaff's
--   -- real hard DELETE FROM admin_users — the first staff deletion for
--   -- someone who ever created an override or audit entry would throw an
--   -- unhandled FK error. Both tables already snapshot the actor's name into
--   -- a separate NOT NULL column (admin_name) for exactly this reason (the
--   -- record must still read correctly after the account is gone), so
--   -- SET NULL is the correct policy here, matching lifted_by's existing
--   -- ON DELETE SET NULL right next to created_by in the same table.
--   ALTER TABLE schedule_overrides
--     MODIFY created_by INT NULL,
--     DROP FOREIGN KEY schedule_overrides_ibfk_2, -- adjust name if it differs on your DB (SHOW CREATE TABLE schedule_overrides)
--     ADD CONSTRAINT fk_schedule_overrides_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL;
--   ALTER TABLE schedule_audit_log
--     MODIFY admin_id INT NULL,
--     DROP FOREIGN KEY schedule_audit_log_ibfk_2, -- adjust name if it differs on your DB (SHOW CREATE TABLE schedule_audit_log)
--     ADD CONSTRAINT fk_schedule_audit_log_admin_id FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL;
--   (password_reset_audit is a new CREATE TABLE IF NOT EXISTS, defined below.)
--
-- Stage 4B — Multi-Hospital SaaS Management: generalizes platform_audit_log
-- (shipped in Stage 4A earlier the same day) to log hospital-admin login
-- events alongside platform actions, and adds the audit-detail fields the
-- stage's requirements called for.
--   ALTER TABLE platform_audit_log
--     ADD COLUMN actor_type ENUM('PlatformAdmin','HospitalAdmin') NOT NULL DEFAULT 'PlatformAdmin' AFTER id,
--     ADD COLUMN hospital_admin_id INT NULL AFTER platform_admin_id,
--     ADD COLUMN ip_address VARCHAR(45) NULL,
--     ADD COLUMN user_agent VARCHAR(500) NULL,
--     ADD COLUMN session_id VARCHAR(64) NULL,
--     CHANGE platform_admin_name actor_name VARCHAR(255) NULL,
--     MODIFY platform_admin_id INT NULL,
--     MODIFY action_type ENUM('HospitalCreated','HospitalEdited','HospitalSuspended','HospitalActivated','HospitalAdminLogin','PlatformLogin') NOT NULL,
--     ADD CONSTRAINT fk_platform_audit_hospital_admin FOREIGN KEY (hospital_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL;

-- whatsapp_business_phone_id/whatsapp_access_token are nullable (not the
-- blueprint's original NOT NULL) because a hospital now exists from the
-- moment of self-registration (see hospitalRegistrationService.js), before
-- its admin has configured WhatsApp via Settings. A hospital with a NULL
-- phone_id simply never matches an incoming webhook (resolveHospitalByPhoneNumberId
-- looks up by exact match), and outbound sendText calls fail closed (caught,
-- logged, not thrown) exactly like an expired/invalid token already does
-- elsewhere in this app — no special-casing needed anywhere else.
CREATE TABLE IF NOT EXISTS hospitals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    whatsapp_business_phone_id VARCHAR(100) UNIQUE NULL,
    whatsapp_access_token VARCHAR(512) NULL,
    multi_branch BOOLEAN DEFAULT FALSE,
    multi_dept BOOLEAN DEFAULT FALSE,
    multi_doctor BOOLEAN DEFAULT FALSE,
    walk_in_only BOOLEAN DEFAULT FALSE,
    approval_required BOOLEAN DEFAULT FALSE,
    payment_required BOOLEAN DEFAULT FALSE,
    emergency_support BOOLEAN DEFAULT TRUE,
    -- Platform-level kill switch (Stage 3.5, ahead of the Stage 4 Super Admin
    -- UI that will actually flip it). A Suspended hospital's staff can't log
    -- in, Reception is locked out, the WhatsApp bot sends a suspension notice
    -- instead of booking, and bookingService.createAppointment refuses to
    -- create any appointment for it regardless of caller — enforced at both
    -- the login/session boundary and the single shared booking choke point,
    -- not just one surface.
    status ENUM('Active', 'Suspended') NOT NULL DEFAULT 'Active',
    -- Admin-panel "Settings > Hospital Info" profile fields, and the
    -- self-registration form (hospitalRegistrationService.js).
    icon VARCHAR(10) DEFAULT '🏥',
    logo VARCHAR(255) NULL,
    address TEXT NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    country VARCHAR(100) NULL DEFAULT 'India',
    pincode VARCHAR(10) NULL,
    phone VARCHAR(20) NULL,
    email VARCHAR(255) NULL,
    website VARCHAR(255) NULL,
    emergency_contact VARCHAR(20) NULL,
    -- Settings > Operating Hours. Unlike doctors.schedule_json (per-doctor,
    -- drives actual token/capacity math), these are the facility's own
    -- hours — saving a change here diffs against existing appointments
    -- (operatingHoursService.previewAffectedAppointments) and can trigger
    -- notify/reschedule/cancel/waitlist, but never constrains what a doctor
    -- can be scheduled for; the two are intentionally independent.
    morning_start TIME DEFAULT '09:00:00',
    morning_end TIME DEFAULT '13:00:00',
    afternoon_start TIME DEFAULT '13:00:00',
    afternoon_end TIME DEFAULT '17:00:00',
    evening_start TIME DEFAULT '17:00:00',
    evening_end TIME DEFAULT '20:00:00',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS branches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hospital_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    -- address/phone/email back the admin panel's Branches management page
    -- (Stage 1). Nullable at the DB level (an existing pre-migration branch
    -- row, e.g. the seeded "Main Branch", has none of these) — "required" is
    -- enforced at the application layer for new creates/updates going
    -- forward, the same pattern hospitalRegistrationService already uses for
    -- its own required fields, rather than a DB NOT NULL that would break on
    -- migration. is_active is deliberately untouched/unrenamed — the
    -- WhatsApp bot (catalogService.getActiveBranches/getDefaultBranch) reads
    -- it directly; "status" (Active/Inactive) shown in the admin UI is
    -- derived from this same column, not a second source of truth.
    address TEXT NULL,
    phone VARCHAR(20) NULL,
    email VARCHAR(255) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    name_hi VARCHAR(255) NOT NULL,
    -- description/display_order/status/updated_at back the admin panel's
    -- Departments management page (Stage 1). status is Active/Inactive
    -- ("archived") — deliberately NOT enforced yet in the WhatsApp bot's own
    -- department picker (catalogService.getDepartments), since that's booking
    -- logic and out of scope for this stage; see the admin service's own
    -- comment for the current, known consequence of that boundary.
    description TEXT NULL,
    display_order INT NOT NULL DEFAULT 0,
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- doctors.schedule_json shape (admin-controlled Booking Capacity, one template
-- applied on every working day — NOT per-weekday customization; a doctor
-- can't have Monday differ from Tuesday, only "works this day or doesn't"):
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
-- shift and drives each token's expected_time directly (start + (token-1) *
-- duration_mins) — not an even split of the window by max_tokens like the
-- old per-weekday model. Validated at save time (doctorAdminService.js via
-- scheduleService.validateSchedule) so max_tokens * duration_mins can never
-- exceed a shift's own window.
CREATE TABLE IF NOT EXISTS doctors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    department_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    -- Display-only profile fields (admin panel Doctors page) — not read by
    -- any booking/availability logic, same category as hospitals.icon etc.
    qualification VARCHAR(255) NULL,
    experience_years INT NULL DEFAULT 0,
    is_on_leave BOOLEAN DEFAULT FALSE,
    consultation_fee DECIMAL(10, 2) DEFAULT 0.00,
    schedule_json JSON NOT NULL,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    -- Generated once, in patientService.createPatient — the single function
    -- both the WhatsApp bot's registration flow and Reception's patient
    -- creation call — as 'UH' + zero-padded id, right after insert.
    uhid VARCHAR(20) NULL UNIQUE,
    hospital_id INT NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    age INT NOT NULL,
    gender ENUM('M', 'F', 'O') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Multi-Patient Family Booking: several family members can share one
    -- WhatsApp number under the same hospital (see patientSelector.js), so
    -- this is a plain lookup index, not a uniqueness constraint. A "primary"
    -- patient for the handful of call sites that still assume one patient
    -- per phone (My Appointments, Live Queue Status, self-service cancel) is
    -- resolved deterministically as the first-ever registered row — see
    -- patientService.findPatient's comment.
    INDEX idx_hospital_phone (hospital_id, phone_number),
    FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_sessions (
    phone_number VARCHAR(20) PRIMARY KEY,
    hospital_id INT NOT NULL,
    current_state VARCHAR(50) NOT NULL DEFAULT 'STATE_MAIN_MENU',
    state_data JSON NULL,
    failure_count INT DEFAULT 0,
    -- NULL until the patient picks a language; lives on its own column (not
    -- inside state_data) specifically so it survives every transitionState/
    -- resetToMainMenu call, which replace state_data wholesale.
    preferred_language ENUM('en', 'hi') NULL,
    last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    appointment_date DATE NOT NULL,
    shift ENUM('Morning', 'Afternoon', 'Evening') NOT NULL,
    token_number INT NOT NULL,
    expected_time TIME NOT NULL,
    -- 'Waitlisted': set by rescheduleService when an emergency-override/hours
    -- change strands this appointment and no doctor in the department has a
    -- near-term opening either — same "keep the old row as history" pattern
    -- already used for 'Rescheduled', paired with a waiting_list row (below)
    -- that tracks the active search separately (this row itself never gets a
    -- new date/shift/token — it has none to give until one is found).
    -- 'No Show' (Reception Panel, Stage 2): a Confirmed appointment the
    -- patient never arrived for — manually marked by reception staff, not an
    -- automatic sweep. Same terminal category as Completed/Cancelled.
    status ENUM('Pending', 'Confirmed', 'Cancelled', 'Completed', 'Pending_Payment', 'Rescheduled', 'Waitlisted', 'No Show') DEFAULT 'Confirmed',
    -- The pre-terminal front-desk sub-workflow, orthogonal to `status` above
    -- (which stays 'Confirmed' throughout) — only meaningful while status is
    -- 'Confirmed'; left at whatever it last was once status goes terminal, so
    -- there's nothing to keep in sync after that point.
    checkin_status ENUM('Waiting', 'Checked In', 'In Consultation') NOT NULL DEFAULT 'Waiting',
    checked_in_at TIMESTAMP NULL,
    checked_in_by INT NULL,
    -- WhatsApp default preserves every existing row's true origin on
    -- migration; Reception's manual-booking vs. walk-in-registration paths
    -- set 'Reception'/'Walk-in' respectively.
    booking_source ENUM('WhatsApp', 'Reception', 'Walk-in') NOT NULL DEFAULT 'WhatsApp',
    payment_status ENUM('Unpaid', 'Pending', 'Paid') DEFAULT 'Unpaid',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Set when the live queue dashboard marks a token as seen (status -> 'Completed').
    -- No separate is_completed boolean — status already has a 'Completed' value,
    -- so a second flag would just be a second source of truth to drift out of sync.
    completed_at TIMESTAMP NULL,
    -- Set by schedulerService's reminder worker once the pre-appointment
    -- WhatsApp nudge goes out, so the 15-minute scan never double-sends it.
    reminder_sent BOOLEAN DEFAULT FALSE,
    reminder_sent_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    cancel_reason VARCHAR(255) NULL,
    -- NULL when the patient self-cancels via WhatsApp; set when Reception/
    -- admin cancels on their behalf (see appointmentAdminService).
    cancelled_by INT NULL,
    -- Reschedule creates a NEW row rather than mutating the old one, so the
    -- original token/date/time stay in the record — this pair links the two:
    -- the old row gets rescheduled_to, the new row gets rescheduled_from.
    rescheduled_from INT NULL,
    rescheduled_to INT NULL,
    status_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (rescheduled_from) REFERENCES appointments(id) ON DELETE SET NULL,
    FOREIGN KEY (rescheduled_to) REFERENCES appointments(id) ON DELETE SET NULL,
    FOREIGN KEY (checked_in_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    FOREIGN KEY (cancelled_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_doctor_date_shift (doctor_id, appointment_date, shift),
    -- Standalone (Stage 3.5 perf review): idx_doctor_date_shift above only
    -- helps a query that also filters by doctor_id — every hospital-wide,
    -- date-scoped query that doesn't (dashboard stats, live queue-for-date,
    -- every Reports & Analytics query) previously had no usable index on
    -- appointment_date at all and fell back to scanning every row for the
    -- hospital.
    INDEX idx_appointment_date (appointment_date),
    -- Guards token allocation against concurrent double-booking of the same slot.
    UNIQUE KEY uniq_doctor_date_shift_token (doctor_id, appointment_date, shift, token_number)
) ENGINE=InnoDB;

-- Reception Panel (Stage 2) status/check-in audit trail — same pattern as
-- schedule_audit_log (a different domain's history table) already
-- established in this schema. admin_name is a snapshot (not just a FK) for
-- the same reason schedule_audit_log.admin_name is: it must still read
-- correctly if the admin account is later renamed or deleted.
CREATE TABLE IF NOT EXISTS appointment_status_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL,
    from_status VARCHAR(30) NULL,
    to_status VARCHAR(30) NOT NULL,
    changed_by INT NULL,
    changed_by_name VARCHAR(255) NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Admin panel staff accounts (JWT login), one hospital per staff account.
-- phone_number + reset_code/reset_code_expires_at power the "Forgot Password"
-- flow: a 6-digit OTP delivered over WhatsApp (the only messaging channel
-- this project has — there's no email/SMTP setup) rather than email.
CREATE TABLE IF NOT EXISTS admin_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hospital_id INT NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    -- Display-only label for the sidebar's profile card (secondary text) —
    -- there is no permission/RBAC system in this project gated on it, it
    -- exists purely so the sidebar can say something more useful than the
    -- hospital name repeated a second time.
    role ENUM('Hospital Administrator', 'Receptionist', 'Super Admin') NOT NULL DEFAULT 'Hospital Administrator',
    phone_number VARCHAR(20) NULL,
    reset_code VARCHAR(10) NULL,
    reset_code_expires_at TIMESTAMP NULL,
    -- Brute-force hardening (Stage 3.5) for resetPassword's 6-digit code:
    -- counts consecutive wrong guesses since the last successful reset (NOT
    -- reset by requesting a fresh OTP — otherwise lockout could be bypassed
    -- by simply calling forgot-password again), and reset_locked_until blocks
    -- further attempts once the threshold is hit. See password_reset_audit
    -- for the corresponding attempt log.
    reset_failed_attempts INT NOT NULL DEFAULT 0,
    reset_locked_until TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Append-only log of every forgot-password/reset-password attempt (Stage
-- 3.5) — a companion to admin_users' live lockout counter above, so a
-- suspicious pattern of failures can be reviewed after the fact even once
-- reset_failed_attempts itself has been cleared by a later successful reset.
-- admin_user_id is nullable (and ON DELETE SET NULL) since a failed attempt
-- against an email that doesn't correspond to any account is still worth
-- logging (email_attempted keeps that case readable) without needing a real
-- FK target.
CREATE TABLE IF NOT EXISTS password_reset_audit (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_user_id INT NULL,
    email_attempted VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NULL,
    action ENUM('OTP_REQUESTED', 'RESET_SUCCESS', 'RESET_FAILED', 'LOCKED_OUT') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Billing. No hospital_id column here (unlike the guide's original design) —
-- every other admin-panel table in this schema derives hospital scoping via
-- patient_id -> patients.hospital_id rather than storing it redundantly on
-- the child row, and bills follows that same convention for consistency.
CREATE TABLE IF NOT EXISTS bills (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    consultation_fee DECIMAL(10,2) DEFAULT 0.00,
    medicine_charges DECIMAL(10,2) DEFAULT 0.00,
    test_charges DECIMAL(10,2) DEFAULT 0.00,
    other_charges DECIMAL(10,2) DEFAULT 0.00,
    discount DECIMAL(10,2) DEFAULT 0.00,
    total_amount DECIMAL(10,2) DEFAULT 0.00,
    payment_method ENUM('Cash', 'UPI', 'Card', 'Online') DEFAULT 'Cash',
    payment_status ENUM('Unpaid', 'Paid', 'Partial') DEFAULT 'Unpaid',
    bill_date DATE NOT NULL,
    paid_at TIMESTAMP NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    -- One bill per appointment/visit.
    UNIQUE KEY uniq_appointment_bill (appointment_id)
) ENGINE=InnoDB;

-- Emergency Schedule Override (Settings > Emergency Override). A hospital-
-- wide or single-shift closure that the booking engine actually enforces
-- (scheduleOverrideService.isClosed, checked from bookingService.createAppointment,
-- capacityController.validateShiftCapacity, and bookingService's availability
-- functions) — not just an administrative note. hospital_id is stored
-- directly (no patient/appointment row to derive it from, same as
-- branches.hospital_id/admin_users.hospital_id).
CREATE TABLE IF NOT EXISTS schedule_overrides (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hospital_id INT NOT NULL,
    scope ENUM('Morning', 'Afternoon', 'Evening', 'Hospital') NOT NULL,
    reason ENUM('Doctor Emergency', 'Hospital Emergency', 'Public Holiday', 'Maintenance', 'Power Failure', 'Other') NOT NULL,
    note VARCHAR(500) NULL,
    -- Open-ended by design: Maintenance/Power Failure don't have a knowable
    -- end time up front, so a closure stays Active until an admin explicitly
    -- lifts it (end_date is here for a possible future "set an end date"
    -- UI, not read by isClosed's enforcement check unless populated).
    start_date DATE NOT NULL,
    end_date DATE NULL,
    status ENUM('Active', 'Lifted') NOT NULL DEFAULT 'Active',
    -- Nullable + SET NULL (Stage 3.5 fix, was NOT NULL + RESTRICT): RESTRICT
    -- would throw an unhandled FK error the first time staffAdminService.
    -- deleteStaff's real hard DELETE FROM admin_users hit an account that had
    -- ever created an override. reason/note/admin_name-style snapshots
    -- elsewhere in this schema exist precisely so a row still reads correctly
    -- after its actor is gone — this FK now matches that same convention
    -- (and lifted_by right below, which was already SET NULL).
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    lifted_by INT NULL,
    lifted_at TIMESTAMP NULL,
    FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    FOREIGN KEY (lifted_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_hospital_status_dates (hospital_id, status, start_date, end_date)
) ENGINE=InnoDB;

-- Patients bumped by an hours change or emergency override who couldn't be
-- auto-rescheduled (same doctor, then same-department any doctor — both
-- exhausted). The bumped appointment itself is kept as history with
-- status='Waitlisted' (see appointments.status comment); this row tracks the
-- active search and, once resolved, points at the new appointment it became.
-- Hospital scoping derives via patient_id -> patients.hospital_id (no
-- redundant hospital_id column here), matching this schema's existing
-- convention — see the comment on the bills table above.
CREATE TABLE IF NOT EXISTS waiting_list (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    original_appointment_id INT NOT NULL,
    preferred_date DATE NOT NULL,
    shift ENUM('Morning', 'Afternoon', 'Evening') NOT NULL,
    status ENUM('Waiting', 'Booked', 'Cancelled') NOT NULL DEFAULT 'Waiting',
    resulting_appointment_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (original_appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (resulting_appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
    INDEX idx_doctor_status (doctor_id, status)
) ENGINE=InnoDB;

-- Permanent record of every operating-hours change and emergency-override
-- create/lift (Settings > Audit Log) — distinct from the derived, read-time
-- "Recent Activity" topbar dropdown (adminActivityService.js), which has no
-- persistence and no notion of who changed what.
CREATE TABLE IF NOT EXISTS schedule_audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hospital_id INT NOT NULL,
    -- Nullable + SET NULL (Stage 3.5 fix, was NOT NULL + RESTRICT) — same
    -- reasoning as schedule_overrides.created_by above: admin_name is already
    -- a permanent snapshot, so the FK no longer needs to block deleting the
    -- actor's account.
    admin_id INT NULL,
    -- Snapshot, not just a FK — must still read correctly if admin_users.name
    -- changes (or the account is later removed) after this entry is written.
    admin_name VARCHAR(255) NOT NULL,
    change_type ENUM('OperatingHours', 'EmergencyOverrideCreated', 'EmergencyOverrideLifted') NOT NULL,
    previous_hours JSON NULL,
    updated_hours JSON NULL,
    override_id INT NULL,
    affected_appointments_count INT NOT NULL DEFAULT 0,
    action_taken ENUM('KeepExisting', 'Reschedule', 'CancelAppointments', 'ChangesCancelled', 'OverrideCreated', 'OverrideLifted') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE,
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
    FOREIGN KEY (override_id) REFERENCES schedule_overrides(id) ON DELETE SET NULL,
    INDEX idx_hospital_created (hospital_id, created_at)
) ENGINE=InnoDB;

-- Stage 4A — Platform Super Admin Foundation. A completely separate identity
-- from admin_users on purpose: platform_admins has no hospital_id (a
-- platform operator doesn't belong to any one tenant) and no role column
-- (unlike admin_users' 3-tier rank, every row here already means the same
-- single "Platform Super Admin" level of access — there's nothing to rank).
-- No public self-registration route exists for this table; the first row is
-- created once via scripts/createPlatformAdmin.js.
CREATE TABLE IF NOT EXISTS platform_admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Append-only record of every platform-level action (hospital created/
-- edited/suspended/activated, plus login events — Stage 4B) — the
-- platform-side counterpart to schedule_audit_log, same
-- snapshot-name-not-just-FK reasoning (every actor FK is SET NULL).
-- actor_type/actor_name/{platform,hospital}_admin_id generalize this table
-- to log actions by EITHER identity: a platform admin acting on a hospital
-- (platform_admin_id set, hospital_admin_id null), or a hospital admin's own
-- login (hospital_admin_id set, platform_admin_id null) — exactly one of the
-- two FKs is populated per row, matching actor_type. ip_address/user_agent/
-- session_id (Stage 4B audit improvements) are captured at the point of
-- action; session_id is a random UUID minted into the JWT at login time
-- (see adminAuthController.js/platformAuthController.js) purely for
-- audit-trail correlation — this app's JWTs are otherwise still fully
-- stateless, no server-side session store was added.
CREATE TABLE IF NOT EXISTS platform_audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    actor_type ENUM('PlatformAdmin', 'HospitalAdmin') NOT NULL DEFAULT 'PlatformAdmin',
    platform_admin_id INT NULL,
    hospital_admin_id INT NULL,
    actor_name VARCHAR(255) NULL,
    action_type ENUM('HospitalCreated', 'HospitalEdited', 'HospitalSuspended', 'HospitalActivated', 'HospitalAdminLogin', 'PlatformLogin') NOT NULL,
    hospital_id INT NULL,
    hospital_name VARCHAR(255) NULL,
    details JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    session_id VARCHAR(64) NULL,
    FOREIGN KEY (platform_admin_id) REFERENCES platform_admins(id) ON DELETE SET NULL,
    FOREIGN KEY (hospital_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
    FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE SET NULL,
    INDEX idx_hospital_created (hospital_id, created_at)
) ENGINE=InnoDB;
