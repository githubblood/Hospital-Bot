// Central bilingual (English + Hindi) message layer.
// Every user-facing string lives here so the two languages stay in lockstep and
// the handlers read cleanly. Convention: English line first, Hindi line directly
// below it; a blank line separates logical sections.
const { getLanguage } = require('./helpers/langContext');

// Keycap number emojis for numbered menus (1-10). Matches the reference style.
const NUM_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣',
    '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// Renders in whichever language the current message is scoped to (see
// langContext) — English only, Hindi only, or both combined (the original
// behavior, used until a patient has picked a language, and for any message
// built outside a request's context, e.g. an admin-triggered WhatsApp send).
function bi(en, hi) {
    const lang = getLanguage();
    if (lang === 'en') return en;
    if (lang === 'hi') return hi;
    return `${en}\n${hi}`;
}

// Seed data sometimes stores the doctor name with the "Dr." title baked in.
// Strip a leading "Dr"/"Dr." so callers can prepend the right title per language
// ("Dr." / "डॉ.") without doubling it up.
function cleanDoctorName(name) {
    return String(name || '').replace(/^\s*dr\.?\s+/i, '').trim();
}

// A DATE column comes back as a JS Date at local midnight; toISOString() would
// shift it back a day in IST. Format from local components to keep the date.
function formatDate(d) {
    if (!d) return d;
    if (typeof d === 'string') return d.slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// dd-mm-yyyy for the WhatsApp bot's own messages only — internal storage
// (DB columns, option ids like `date_2026-07-17`, the admin panel's date
// inputs/reports) all stay ISO (yyyy-mm-dd); this is purely a display layer
// on top, applied at the point a date is shown to a patient.
function formatDateDisplay(d) {
    const iso = formatDate(d);
    if (!iso) return iso;
    const [y, m, day] = iso.split('-');
    return `${day}-${m}-${y}`;
}

// SQL TIME "09:00:00" -> "9:00 AM".
function formatTime(t) {
    if (!t) return t;
    const [h, m] = String(t).split(':');
    let hh = parseInt(h, 10);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12;
    if (hh === 0) hh = 12;
    return `${hh}:${m} ${ampm}`;
}

const HINDI_WEEKDAYS = {
    sunday: 'रविवार', monday: 'सोमवार', tuesday: 'मंगलवार', wednesday: 'बुधवार',
    thursday: 'गुरुवार', friday: 'शुक्रवार', saturday: 'शनिवार'
};

const HINDI_SHIFT = { Morning: 'सुबह', Afternoon: 'दोपहर', Evening: 'शाम' };

// NOTE on `get propName()` below: these render per-message via bi(), which
// reads the *current* request's language from langContext. A plain
// `propName: bi(...)` would instead be evaluated once, the moment this module
// is first require()'d (before any patient's language is known) and then
// cached forever as whatever bi() returned at that instant — every later read
// would silently ignore the patient's actual chosen language. Getters make
// each read call bi() fresh, exactly like the function-valued entries
// (mainMenuHeader, confirmed, etc.) already do.
const M = {
    NUM_EMOJI,
    HINDI_WEEKDAYS,
    HINDI_SHIFT,
    bi,
    cleanDoctorName,
    formatDate,
    formatDateDisplay,
    formatTime,

    // Footer shown under every numbered menu.
    get MENU_FOOTER() {
        return bi('Reply with a number, or type "menu" for the main menu.',
                  'कोई नंबर भेजें, या मुख्य मेन्यू के लिए "menu" लिखें।');
    },

    // ---- Language selection (asked once, before the very first main menu) ----
    get languagePrompt() { return bi('Choose your language:', 'अपनी भाषा चुनें:'); },
    languageOptions: [
        { id: 'lang_en', label: 'English' },
        { id: 'lang_hi', label: 'हिंदी' }
    ],
    get invalidLanguage() {
        return bi('Please reply 1 for English or 2 for Hindi.', 'कृपया अंग्रेज़ी के लिए 1 या हिंदी के लिए 2 भेजें।');
    },

    // ---- Main menu ----
    // Full greeting — shown once when a session actually arrives fresh at the
    // main menu (see sendMainMenu). NOT reused for the invalid-input retry
    // list below; re-sending the whole "Namaste, I'm your assistant..." intro
    // on every single mistyped reply was the "keeps repeating" bug — see
    // mainMenuRetryHeader for that path instead.
    mainMenuHeader: (name) => [
        bi(`Namaste! I am the ${name} Assistant. 🙋`, `नमस्ते! मैं ${name} असिस्टेंट हूँ। 🙋`),
        '',
        bi('I can help you book appointments and check status instantly.',
           'मैं आपकी अपॉइंटमेंट बुकिंग और स्थिति तुरंत बता सकता हूँ।'),
        '',
        bi('How can I help you today?', 'मैं आपकी कैसे मदद कर सकता हूँ?')
    ].join('\n'),

    get mainMenuRetryHeader() { return bi('How can I help you today?', 'मैं आपकी कैसे मदद कर सकता हूँ?'); },

    menuOptions: [
        { id: 'main_book', label: 'Book Appointment', labelHi: 'अपॉइंटमेंट बुक करें' },
        { id: 'main_my_appts', label: 'My Appointments', labelHi: 'अपनी बुकिंग देखें' },
        { id: 'main_queue_status', label: 'Live Queue Status', labelHi: 'लाइव क्यू स्थिति' },
        { id: 'main_help', label: 'Help', labelHi: 'सहायता' }
    ],

    get queueStatusHeader() { return bi('📊 Your live queue status:', '📊 आपकी लाइव क्यू स्थिति:'); },
    get noLiveQueueToday() {
        return bi(
            "You don't have a confirmed appointment for today. Book one from the main menu.",
            'आपकी आज के लिए कोई कन्फर्म अपॉइंटमेंट नहीं है। मुख्य मेन्यू से बुक करें।'
        );
    },

    get helpText() {
        return bi(
            "Reply 'menu' anytime to return to the main menu, or 'emergency' for urgent help. Use the numbered options to navigate.",
            "किसी भी समय मुख्य मेन्यू के लिए 'menu' लिखें, या तुरंत मदद के लिए 'emergency'। नेविगेट करने के लिए नंबर वाले विकल्प इस्तेमाल करें।"
        );
    },

    get invalidMainMenu() { return bi('Please reply with a number from the list.', 'कृपया सूची में से कोई नंबर भेजें।'); },

    // ---- Emergency (Scenario 7) ----
    get emergency() {
        return bi(
            '🛑 This looks like a medical emergency. Please call 102/112 immediately or go to the nearest Emergency ward.',
            '🛑 यह एक मेडिकल इमरजेंसी लगती है। कृपया तुरंत 102/112 पर कॉल करें या नज़दीकी इमरजेंसी वार्ड जाएँ।'
        );
    },

    // ---- Pickers (headers) ----
    get selectBranch() { return bi('Select a branch:', 'ब्रांच चुनें:'); },
    get selectDept() { return bi('Select a department:', 'विभाग चुनें:'); },
    get selectDoctor() { return bi('Select a doctor:', 'डॉक्टर चुनें:'); },
    get selectDate() { return bi('Select a date:', 'तारीख चुनें:'); },
    get selectShift() { return bi('Select a time slot:', 'समय चुनें:'); },

    get invalidBranch() { return bi('Please pick a valid branch from the list.', 'कृपया सूची में से सही ब्रांच चुनें।'); },
    get invalidDept() { return bi('Please pick a valid department from the list.', 'कृपया सूची में से सही विभाग चुनें।'); },
    get invalidDoctor() { return bi('Please pick a valid doctor from the list.', 'कृपया सूची में से सही डॉक्टर चुनें।'); },
    get invalidDate() { return bi('Please pick a valid date from the list.', 'कृपया सूची में से सही तारीख चुनें।'); },
    get invalidShift() { return bi('Please pick a valid time slot from the list.', 'कृपया सूची में से सही समय चुनें।'); },

    // ---- Catalog empty states ----
    get noBranches() {
        return bi('No active branches are configured. Please contact the hospital directly.',
                  'कोई सक्रिय ब्रांच उपलब्ध नहीं है। कृपया सीधे अस्पताल से संपर्क करें।');
    },
    get noDepts() {
        return bi('No departments are configured for this branch. Please contact the hospital directly.',
                  'इस ब्रांच के लिए कोई विभाग उपलब्ध नहीं है। कृपया सीधे अस्पताल से संपर्क करें।');
    },
    get noDoctors() {
        return bi('No doctors are currently available in this department. Please try again later.',
                  'इस विभाग में अभी कोई डॉक्टर उपलब्ध नहीं है। कृपया बाद में प्रयास करें।');
    },

    // ---- Scenario 9: fully booked ----
    fullyBooked: (doctorName, next) => {
        const dn = cleanDoctorName(doctorName);
        const en = `Dr. ${dn} is fully booked for the next 7 days.`;
        const hi = `डॉ. ${dn} अगले 7 दिनों के लिए पूरी तरह बुक हैं।`;
        if (!next) return bi(en, hi);
        const nd = formatDateDisplay(next.date);
        return bi(
            `${en} The next free slot is ${nd} (${next.weekday}, ${next.shift}).`,
            `${hi} अगला खाली स्लॉट ${nd} (${HINDI_WEEKDAYS[next.weekday] || next.weekday}, ${HINDI_SHIFT[next.shift] || next.shift}) है।`
        );
    },
    dateFilledUp: (next) => {
        const en = 'That date just filled up.';
        const hi = 'वह तारीख अभी भर गई।';
        if (!next) return bi(en, hi);
        const nd = formatDateDisplay(next.date);
        return bi(
            `${en} The next free slot is ${nd} (${next.weekday}, ${next.shift}).`,
            `${hi} अगला खाली स्लॉट ${nd} (${HINDI_WEEKDAYS[next.weekday] || next.weekday}, ${HINDI_SHIFT[next.shift] || next.shift}) है।`
        );
    },
    slotJustFilled: (next) => {
        const en = 'Sorry, that slot just filled up.';
        const hi = 'क्षमा करें, वह स्लॉट अभी भर गया।';
        if (!next) return bi(en, hi);
        const nd = formatDateDisplay(next.date);
        return bi(
            `${en} The next free slot is ${nd} (${next.weekday}, ${next.shift}).`,
            `${hi} अगला खाली स्लॉट ${nd} (${HINDI_WEEKDAYS[next.weekday] || next.weekday}, ${HINDI_SHIFT[next.shift] || next.shift}) है।`
        );
    },

    // ---- Shift / date option descriptions ----
    dateDescription: (weekday) => bi(weekday, HINDI_WEEKDAYS[weekday] || weekday),
    shiftLabelHi: (shift) => HINDI_SHIFT[shift] || shift,

    // ---- Confirm ----
    // confirmPrompt/confirmOptions/invalidConfirm stay Yes/No — shared with
    // reschedule.js and cancelConfirm.js. confirmQuestion, bookingConfirmOptions,
    // and invalidBookingConfirm below are dedicated to the appointment-booking
    // confirm step only (selectShift.js/confirmBooking.js), so its wording can
    // diverge (Confirm/Cancel) without changing those other flows.
    get confirmPrompt() { return bi('Please confirm your booking:', 'कृपया अपनी बुकिंग की पुष्टि करें:'); },
    get appointmentSummaryTitle() { return bi('📋 Appointment Summary', '📋 अपॉइंटमेंट सारांश'); },
    get confirmQuestion() { return bi('Please confirm your appointment.', 'कृपया अपनी अपॉइंटमेंट की पुष्टि करें।'); },
    confirmOptions: [
        { id: 'confirm_yes', label: 'Yes', labelHi: 'हाँ' },
        { id: 'confirm_no', label: 'No', labelHi: 'नहीं' }
    ],
    bookingConfirmOptions: [
        { id: 'confirm_yes', label: 'Confirm', labelHi: 'पुष्टि करें' },
        { id: 'confirm_no', label: 'Cancel', labelHi: 'रद्द करें' }
    ],
    get invalidConfirm() { return bi('Please reply 1 for Yes or 2 for No.', 'कृपया हाँ के लिए 1 या नहीं के लिए 2 भेजें।'); },
    get invalidBookingConfirm() { return bi('Please reply 1 to Confirm or 2 to Cancel.', 'कृपया पुष्टि के लिए 1 या रद्द करने के लिए 2 भेजें।'); },
    get bookingCancelled() { return bi('Booking cancelled.', 'बुकिंग रद्द कर दी गई।'); },

    bookingSummary: (doctor, date, shift) => {
        const dn = cleanDoctorName(doctor.name);
        const dd = formatDateDisplay(date);
        return [
            bi(`👨 Doctor: Dr. ${dn}`, `👨 डॉक्टर: डॉ. ${dn}`),
            bi(`📅 Date: ${dd}`, `📅 तारीख: ${dd}`),
            bi(`🕘 Shift: ${shift}`, `🕘 समय: ${HINDI_SHIFT[shift] || shift}`),
            bi(`💰 Consultation Fee: ₹${doctor.consultation_fee}`, `💰 परामर्श शुल्क: ₹${doctor.consultation_fee}`)
        ].join('\n');
    },

    // ---- Booking outcomes ----
    confirmed: (doctorName, date, shift, tokenNumber, expectedTime) => {
        const dn = cleanDoctorName(doctorName);
        const t = formatTime(expectedTime);
        const dd = formatDateDisplay(date);
        return [
            bi('✅ Appointment Confirmed', '✅ अपॉइंटमेंट सफलतापूर्वक बुक हो गया'),
            '',
            bi(`🔢 Token Number : ${tokenNumber}`, `🔢 टोकन नंबर : ${tokenNumber}`),
            bi(`🕐 Expected Time : ${t}`, `🕐 अनुमानित समय : ${t}`),
            bi(`📍 Shift : ${shift}`, `📍 समय : ${HINDI_SHIFT[shift] || shift}`),
            bi(`🧑‍⚕️ Doctor : Dr. ${dn}`, `🧑‍⚕️ डॉक्टर : डॉ. ${dn}`),
            bi(`📅 Date : ${dd}`, `📅 तारीख : ${dd}`)
        ].join('\n');
    },

    pendingApproval: (tokenNumber, date, shift) => bi(
        `📝 Your booking request (Token #${tokenNumber}, ${formatDateDisplay(date)} ${shift}) is submitted and pending hospital approval. We'll notify you once it's confirmed.`,
        `📝 आपकी बुकिंग अनुरोध (टोकन #${tokenNumber}, ${formatDateDisplay(date)} ${HINDI_SHIFT[shift] || shift}) जमा हो गया है और अस्पताल की मंज़ूरी की प्रतीक्षा में है। पुष्टि होते ही हम आपको सूचित करेंगे।`
    ),

    pendingPayment: (doctorName, date, shift, tokenNumber, expectedTime, fee) => {
        const dn = cleanDoctorName(doctorName);
        const t = formatTime(expectedTime);
        return [
            bi('🧾 Almost done — payment pending.', '🧾 लगभग हो गया — भुगतान बाकी है।'),
            '',
            bi(`🔢 Token Number : ${tokenNumber}`, `🔢 टोकन नंबर : ${tokenNumber}`),
            bi(`🕐 Expected Time : ${t}`, `🕐 अनुमानित समय : ${t}`),
            bi(`📍 Shift : ${shift}`, `📍 समय : ${HINDI_SHIFT[shift] || shift}`),
            bi(`🧑‍⚕️ Doctor : Dr. ${dn}`, `🧑‍⚕️ डॉक्टर : डॉ. ${dn}`),
            '',
            bi(`💵 Consultation fee ₹${fee}. Please pay at the counter/UPI on arrival — our staff will confirm and your appointment will be marked Confirmed.`,
               `💵 परामर्श शुल्क ₹${fee}। कृपया पहुँचने पर काउंटर/UPI से भुगतान करें — हमारा स्टाफ पुष्टि करेगा और आपकी अपॉइंटमेंट कन्फर्म हो जाएगी।`)
        ].join('\n');
    },

    get awaitingPaymentDefault() {
        return bi(
            'Your appointment is awaiting payment confirmation from our staff.',
            'आपकी अपॉइंटमेंट हमारे स्टाफ से भुगतान की पुष्टि की प्रतीक्षा में है।'
        );
    },

    // ---- Patient registration ----
    get registerPrompt() {
        return bi(
            "You're new here — please share your details as: Name, Age, Gender\ne.g. Ravi Kumar, 34, M",
            'आप यहाँ नए हैं — कृपया अपनी जानकारी इस तरह भेजें: नाम, उम्र, लिंग\nजैसे: Ravi Kumar, 34, M'
        );
    },
    get registerError() {
        return bi(
            "That doesn't match the expected format. Please send: Name, Age, Gender (M/F/O)\ne.g. Ravi Kumar, 34, M",
            'यह सही प्रारूप में नहीं है। कृपया भेजें: नाम, उम्र, लिंग (M/F/O)\nजैसे: Ravi Kumar, 34, M'
        );
    },

    // ---- Multi-Patient Family Booking: who is this appointment for? ----
    get choosePatientHeader() {
        return bi('Who is the appointment for?', 'अपॉइंटमेंट किसके लिए है?');
    },
    get invalidPatientChoice() {
        return bi("Please pick a valid option from the list, or reply 'menu' to go back.",
                  "कृपया सूची में से सही विकल्प चुनें, या वापस जाने के लिए 'menu' लिखें।");
    },
    newFamilyMemberOption: { id: 'patient_new', label: 'New Family Member', labelHi: 'नया परिवार का सदस्य' },
    patientChoiceLabel: (p) => `${p.name} (${p.age}, ${p.gender})`,
    get addFamilyMemberPrompt() {
        return bi(
            "Let's add a new family member. Please share their details as: Name, Age, Gender\ne.g. Ravi Kumar, 34, M",
            'आइए एक नया परिवार का सदस्य जोड़ें। कृपया उनकी जानकारी इस तरह भेजें: नाम, उम्र, लिंग\nजैसे: Ravi Kumar, 34, M'
        );
    },

    // ---- My appointments ----
    get noAppointmentsYet() {
        return bi(
            "You don't have any appointments yet. Book one from the main menu.",
            'आपकी अभी कोई अपॉइंटमेंट नहीं है। मुख्य मेन्यू से बुक करें।'
        );
    },
    get noUpcoming() { return bi('You have no upcoming appointments.', 'आपकी कोई आगामी अपॉइंटमेंट नहीं है।'); },
    get myAppointmentsHeader() {
        return bi('Your appointments (reply with a number to cancel):', 'आपकी अपॉइंटमेंट (रद्द करने के लिए नंबर भेजें):');
    },
    get invalidAppointment() {
        return bi("Please pick a valid appointment number to cancel, or reply 'menu' to go back.",
                  "रद्द करने के लिए सही नंबर भेजें, या वापस जाने के लिए 'menu' लिखें।");
    },
    get cancelSuccess() {
        return bi(
            '✅ Your appointment has been cancelled successfully. If you wish to visit again, please book a new appointment.',
            '✅ आपकी अपॉइंटमेंट सफलतापूर्वक रद्द कर दी गई है। यदि आप दोबारा आना चाहते हैं, तो कृपया नई अपॉइंटमेंट बुक करें।'
        );
    },
    get cancelFail() {
        return bi('Could not cancel that appointment (it may already be cancelled).',
                  'वह अपॉइंटमेंट रद्द नहीं हो सकी (शायद पहले से रद्द है)।');
    },
    get cancelConfirmQuestion() {
        return bi('Are you sure you want to cancel this appointment?', 'क्या आप वाकई इस अपॉइंटमेंट को रद्द करना चाहते हैं?');
    },
    get cancelAborted() {
        return bi("Okay, your appointment has not been cancelled.", 'ठीक है, आपकी अपॉइंटमेंट रद्द नहीं की गई है।');
    },
    appointmentDescription: (token, status) => `Token #${token} · ${status}`,

    // ---- My appointment: single-appointment detail + action submenu ----
    myAppointmentDetail: (hospital, appt) => {
        const dn = cleanDoctorName(appt.doctor_name);
        const dd = formatDateDisplay(appt.appointment_date);
        const t = formatTime(appt.expected_time);
        const lines = [
            bi(`🏥 ${hospital.name}`, `🏥 ${hospital.name}`),
            '',
            bi(`🧑‍⚕️ Doctor : Dr. ${dn}`, `🧑‍⚕️ डॉक्टर : डॉ. ${dn}`)
        ];
        if (appt.department_name) {
            lines.push(bi(`📋 Department : ${appt.department_name}`, `📋 विभाग : ${appt.department_name_hi || appt.department_name}`));
        }
        lines.push(
            bi(`📅 Date : ${dd}`, `📅 तारीख : ${dd}`),
            bi(`📍 Shift : ${appt.shift}`, `📍 समय : ${HINDI_SHIFT[appt.shift] || appt.shift}`),
            bi(`🕐 Expected Time : ${t}`, `🕐 अनुमानित समय : ${t}`),
            bi(`🔢 Token Number : ${appt.token_number}`, `🔢 टोकन नंबर : ${appt.token_number}`),
            bi(`ℹ️ Status : ${appt.status}`, `ℹ️ स्थिति : ${appt.status}`)
        );
        return lines.join('\n');
    },
    get myAppointmentSubmenuHeader() {
        return bi('What would you like to do?', 'आप क्या करना चाहेंगे?');
    },
    myAppointmentOptions: [
        { id: 'appt_view_queue', label: 'View Live Queue', labelHi: 'लाइव कतार देखें' },
        { id: 'appt_reschedule', label: 'Reschedule', labelHi: 'पुनर्निर्धारित करें' },
        { id: 'appt_cancel', label: 'Cancel Appointment', labelHi: 'अपॉइंटमेंट रद्द करें' },
        { id: 'appt_contact', label: 'Contact Reception', labelHi: 'रिसेप्शन से संपर्क करें' },
        { id: 'appt_back', label: 'Back to Main Menu', labelHi: 'मुख्य मेन्यू पर वापस जाएं' }
    ],
    get invalidMyAppointmentOption() {
        return bi("Please pick a valid option from the list, or reply 'menu' to go back.",
                  "कृपया सूची में से सही विकल्प चुनें, या वापस जाने के लिए 'menu' लिखें।");
    },
    contactReception: (hospital) => {
        const parts = [bi('📞 Contact Reception', '📞 रिसेप्शन से संपर्क करें')];
        if (hospital.phone) parts.push(bi(`Phone: ${hospital.phone}`, `फोन: ${hospital.phone}`));
        if (hospital.address) parts.push(bi(`Address: ${hospital.address}`, `पता: ${hospital.address}`));
        if (!hospital.phone && !hospital.address) {
            parts.push(bi('Please visit the hospital front desk for assistance.', 'कृपया सहायता के लिए अस्पताल के फ्रंट डेस्क पर जाएं।'));
        }
        return parts.join('\n');
    },

    // ---- Reschedule (same doctor, new date/shift; reuses the booking flow's
    // date/shift/confirm messages above where the content is already generic) ----
    rescheduleSummary: (doctor, date, shift) => {
        const dn = cleanDoctorName(doctor.name);
        const dd = formatDateDisplay(date);
        return [
            bi(`🧑‍⚕️ Doctor : Dr. ${dn}`, `🧑‍⚕️ डॉक्टर : डॉ. ${dn}`),
            bi(`📅 New Date : ${dd}`, `📅 नई तारीख : ${dd}`),
            bi(`📍 Shift : ${shift}`, `📍 समय : ${HINDI_SHIFT[shift] || shift}`)
        ].join('\n');
    },
    get rescheduleConfirmQuestion() { return bi('Confirm reschedule?', 'पुनर्निर्धारण की पुष्टि करें?'); },
    get rescheduleCancelled() {
        return bi('Reschedule cancelled. Your original appointment remains unchanged.',
                  'पुनर्निर्धारण रद्द कर दिया गया। आपकी मूल अपॉइंटमेंट अपरिवर्तित है।');
    },
    rescheduled: (doctorName, date, shift, tokenNumber, expectedTime) => {
        const dn = cleanDoctorName(doctorName);
        const t = formatTime(expectedTime);
        const dd = formatDateDisplay(date);
        return [
            bi('✅ Appointment Rescheduled', '✅ अपॉइंटमेंट पुनर्निर्धारित हो गई'),
            '',
            bi(`🔢 New Token Number : ${tokenNumber}`, `🔢 नया टोकन नंबर : ${tokenNumber}`),
            bi(`🕐 Expected Time : ${t}`, `🕐 अनुमानित समय : ${t}`),
            bi(`📍 Shift : ${shift}`, `📍 समय : ${HINDI_SHIFT[shift] || shift}`),
            bi(`🧑‍⚕️ Doctor : Dr. ${dn}`, `🧑‍⚕️ डॉक्टर : डॉ. ${dn}`),
            bi(`📅 Date : ${dd}`, `📅 तारीख : ${dd}`)
        ].join('\n');
    },

    // ---- Invalid-input escalation ----
    get escalation() {
        return bi(
            "That didn't match any option a few times in a row, so let's start over.",
            'कुछ बार सही विकल्प नहीं मिला, तो चलिए फिर से शुरू करते हैं।'
        );
    },

    // ---- Walk-in (Scenario 4) ----
    walkInTitle: (name) => bi(
        `🏥 ${name} — Walk-in OPD. No appointment needed; just visit during the hours below.`,
        `🏥 ${name} — वॉक-इन ओपीडी। अपॉइंटमेंट की ज़रूरत नहीं; नीचे दिए समय पर आएँ।`
    ),
    get walkInNoDoctors() {
        return bi('Please contact the hospital reception for current OPD timings.',
                  'कृपया मौजूदा ओपीडी समय के लिए अस्पताल रिसेप्शन से संपर्क करें।');
    },
    get walkInEmergency() {
        return bi('🚑 Emergency: call 102/112 or visit the Emergency ward (24×7).',
                  '🚑 इमरजेंसी: 102/112 पर कॉल करें या इमरजेंसी वार्ड जाएँ (24×7)।');
    },
    get walkInTruncated() {
        return bi('…\nContact reception for the full doctor list.',
                  '…\nपूरी डॉक्टर सूची के लिए रिसेप्शन से संपर्क करें।');
    }
};

module.exports = M;
