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
    -- Admin-panel "Settings > Hospital Info" profile fields, and the
    -- self-registration form (hospitalRegistrationService.js). Purely
    -- informational/display data — actual booking availability still comes
    -- from each doctor's own schedule_json, not these hospital-level hours.
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
    morning_start TIME DEFAULT '09:00:00',
    morning_end TIME DEFAULT '13:00:00',
    evening_start TIME DEFAULT '17:00:00',
    evening_end TIME DEFAULT '20:00:00',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS branches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hospital_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    name_hi VARCHAR(255) NOT NULL,
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
    is_on_leave BOOLEAN DEFAULT FALSE,
    consultation_fee DECIMAL(10, 2) DEFAULT 0.00,
    schedule_json JSON NOT NULL,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patients (
    id INT AUTO_INCREMENT PRIMARY KEY,
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
    status ENUM('Pending', 'Confirmed', 'Cancelled', 'Completed', 'Pending_Payment', 'Rescheduled') DEFAULT 'Confirmed',
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
    INDEX idx_doctor_date_shift (doctor_id, appointment_date, shift),
    -- Guards token allocation against concurrent double-booking of the same slot.
    UNIQUE KEY uniq_doctor_date_shift_token (doctor_id, appointment_date, shift, token_number)
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
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
