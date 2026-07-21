const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminAuthController = require('../controllers/adminAuthController');
const adminStatsController = require('../controllers/adminStatsController');
const adminAppointmentsController = require('../controllers/adminAppointmentsController');
const adminDoctorsController = require('../controllers/adminDoctorsController');
const adminDepartmentsController = require('../controllers/adminDepartmentsController');
const adminPatientsController = require('../controllers/adminPatientsController');
const adminActivityController = require('../controllers/adminActivityController');
const adminQueueController = require('../controllers/adminQueueController');
const adminBillingController = require('../controllers/adminBillingController');
const adminReportsController = require('../controllers/adminReportsController');
const settingsController = require('../controllers/settingsController');
const scheduleController = require('../controllers/scheduleController');
const adminStaffController = require('../controllers/adminStaffController');
const adminBranchesController = require('../controllers/adminBranchesController');
const adminReceptionController = require('../controllers/adminReceptionController');
const adminAuth = require('../middleware/adminAuth');
const jwtAuth = require('../middleware/jwtAuth');
const requireRole = require('../middleware/requireRole');
const requireActiveHospital = require('../middleware/requireActiveHospital');
const uploadLogo = require('../middleware/uploadLogo');
const { loginLimiter, registerLimiter, forgotPasswordLimiter, resetPasswordLimiter } = require('../middleware/rateLimiters');

// Static-API-key routes: server-to-server/automation use (unchanged).
router.post('/appointments/:id/confirm-payment', adminAuth, adminController.confirmPayment);
router.post('/appointments/:id/approve', adminAuth, adminController.approveAppointment);
router.post('/appointments/:id/reject', adminAuth, adminController.rejectAppointment);
router.post('/doctor/leave', adminAuth, adminController.toggleDoctorLeave);
router.post('/queue/next', adminAuth, adminController.advanceQueue);
router.patch('/hospitals/config', adminAuth, adminController.updateHospitalConfig);

// JWT-login routes: the admin panel UI.
router.post('/register-hospital', registerLimiter, uploadLogo, adminAuthController.registerHospital);
router.post('/login', loginLimiter, adminAuthController.login);
router.post('/logout', adminAuthController.logout);
router.post('/forgot-password', forgotPasswordLimiter, adminAuthController.forgotPassword);
router.post('/reset-password', resetPasswordLimiter, adminAuthController.resetPassword);
router.get('/stats', jwtAuth, adminStatsController.getStats);
router.get('/stats/today-overview', jwtAuth, adminStatsController.getTodayOverview);
router.get('/stats/charts', jwtAuth, adminStatsController.getChartsData);

router.get('/appointments', jwtAuth, adminAppointmentsController.list);
// Must precede /appointments/:id below — otherwise Express would match this
// path as if "cancelled" were the :id param.
router.delete('/appointments/cancelled', jwtAuth, adminAppointmentsController.removeCancelled);
router.get('/appointments/:id', jwtAuth, adminAppointmentsController.getOne);
router.delete('/appointments/:id', jwtAuth, adminAppointmentsController.remove);
router.patch('/appointments/:id/approve', jwtAuth, adminAppointmentsController.approve);
router.patch('/appointments/:id/reject', jwtAuth, adminAppointmentsController.reject);
router.patch('/appointments/:id/cancel', jwtAuth, adminAppointmentsController.cancel);
router.patch('/appointments/:id/reschedule', jwtAuth, adminAppointmentsController.reschedule);

// Reception Panel — Receptionist and Hospital Administrator (Super Admin
// implicitly too, since it outranks Hospital Administrator in the same rank
// system every other requireRole gate in this file already uses). Cancel and
// Reschedule are deliberately NOT duplicated here — Reception reuses the
// existing /appointments/:id/cancel and /reschedule routes directly above,
// which already have no role restriction beyond authentication.
// requireActiveHospital (Stage 3.5) locks Reception out entirely — read and
// write alike — the moment a hospital is suspended, rather than only
// blocking the two appointment-creation routes; a suspended hospital's front
// desk shouldn't be usable at all, not just unable to book.
router.get('/reception/dashboard', jwtAuth, requireActiveHospital, requireRole('Receptionist'), adminReceptionController.getDashboard);
router.get('/reception/appointments', jwtAuth, requireActiveHospital, requireRole('Receptionist'), adminReceptionController.searchAppointments);
router.post('/reception/appointments', jwtAuth, requireActiveHospital, requireRole('Receptionist'), adminReceptionController.createAppointment);
router.post('/reception/walk-ins', jwtAuth, requireActiveHospital, requireRole('Receptionist'), adminReceptionController.createWalkIn);
router.patch('/reception/appointments/:id/check-in', jwtAuth, requireActiveHospital, requireRole('Receptionist'), adminReceptionController.checkIn);
router.patch('/reception/appointments/:id/start-consultation', jwtAuth, requireActiveHospital, requireRole('Receptionist'), adminReceptionController.startConsultation);
router.patch('/reception/appointments/:id/complete', jwtAuth, requireActiveHospital, requireRole('Receptionist'), adminReceptionController.complete);
router.patch('/reception/appointments/:id/no-show', jwtAuth, requireActiveHospital, requireRole('Receptionist'), adminReceptionController.markNoShow);
router.get('/reception/appointments/:id/timeline', jwtAuth, requireActiveHospital, requireRole('Receptionist'), adminReceptionController.getTimeline);

router.get('/doctors', jwtAuth, adminDoctorsController.list);
router.get('/doctors/:id', jwtAuth, adminDoctorsController.getOne);
router.post('/doctors', jwtAuth, requireRole('Hospital Administrator'), adminDoctorsController.create);
router.put('/doctors/:id', jwtAuth, requireRole('Hospital Administrator'), adminDoctorsController.update);
router.patch('/doctors/:id/leave', jwtAuth, requireRole('Hospital Administrator'), adminDoctorsController.toggleLeave);
router.delete('/doctors/:id', jwtAuth, requireRole('Hospital Administrator'), adminDoctorsController.remove);
router.get('/doctors/:id/availability', jwtAuth, adminDoctorsController.getAvailability);

// Branches — GET follows the existing admin architecture (open to any
// authenticated staff, matching Doctors'/Patients' own GET routes); only
// mutating actions are Hospital-Administrator-gated.
router.get('/branches', jwtAuth, adminBranchesController.list);
router.get('/branches/:id', jwtAuth, adminBranchesController.getOne);
router.post('/branches', jwtAuth, requireRole('Hospital Administrator'), adminBranchesController.create);
router.put('/branches/:id', jwtAuth, requireRole('Hospital Administrator'), adminBranchesController.update);
router.patch('/branches/:id/archive', jwtAuth, requireRole('Hospital Administrator'), adminBranchesController.archive);
router.patch('/branches/:id/restore', jwtAuth, requireRole('Hospital Administrator'), adminBranchesController.restore);

router.get('/departments', jwtAuth, adminDepartmentsController.list);
router.get('/departments/full', jwtAuth, requireRole('Hospital Administrator'), adminDepartmentsController.listFull);
router.get('/departments/:id', jwtAuth, requireRole('Hospital Administrator'), adminDepartmentsController.getOne);
router.post('/departments', jwtAuth, requireRole('Hospital Administrator'), adminDepartmentsController.create);
router.put('/departments/:id', jwtAuth, requireRole('Hospital Administrator'), adminDepartmentsController.update);
router.patch('/departments/:id/archive', jwtAuth, requireRole('Hospital Administrator'), adminDepartmentsController.archive);
router.patch('/departments/:id/restore', jwtAuth, requireRole('Hospital Administrator'), adminDepartmentsController.restore);

router.get('/patients', jwtAuth, adminPatientsController.list);
router.get('/patients/:id', jwtAuth, adminPatientsController.getOne);

router.get('/activity', jwtAuth, adminActivityController.getActivity);

router.get('/queue/all', jwtAuth, adminQueueController.getAllQueues);
router.get('/queue/today', jwtAuth, adminQueueController.getTodayQueue);
router.get('/queue/live', jwtAuth, adminQueueController.getLiveStats);
router.patch('/queue/next', jwtAuth, adminQueueController.moveToNext);
router.get('/queue/stream', adminQueueController.streamQueue);

router.get('/billing/stats', jwtAuth, adminBillingController.getStats);
router.get('/billing', jwtAuth, adminBillingController.list);
router.post('/billing', jwtAuth, adminBillingController.create);
router.get('/billing/:id', jwtAuth, adminBillingController.getOne);
router.patch('/billing/:id/pay', jwtAuth, adminBillingController.markPaid);
router.post('/billing/:id/whatsapp', jwtAuth, adminBillingController.sendWhatsApp);
router.get('/patients/:patientId/appointments/unbilled', jwtAuth, adminBillingController.getUnbilledForPatient);

router.get('/reports/today', jwtAuth, adminReportsController.getTodayReport);

// Reports & Analytics (Stage 3) — Hospital Administrator and above only
// (Super Admin already outranks it in the same rank system every other
// requireRole gate here uses; Receptionist is deliberately excluded, unlike
// /reports/today above which stays open to every authenticated admin).
// Read-only: every handler these route to only ever runs SELECT queries.
router.get('/reports/analytics/filters', jwtAuth, requireRole('Hospital Administrator'), adminReportsController.getFilterOptions);
router.get('/reports/analytics/appointments', jwtAuth, requireRole('Hospital Administrator'), adminReportsController.getAppointmentReport);
router.get('/reports/analytics/doctors', jwtAuth, requireRole('Hospital Administrator'), adminReportsController.getDoctorReport);
router.get('/reports/analytics/departments', jwtAuth, requireRole('Hospital Administrator'), adminReportsController.getDepartmentReport);
router.get('/reports/analytics/branches', jwtAuth, requireRole('Hospital Administrator'), adminReportsController.getBranchReport);
router.get('/reports/analytics/reception', jwtAuth, requireRole('Hospital Administrator'), adminReportsController.getReceptionReport);
router.get('/reports/analytics/patients', jwtAuth, requireRole('Hospital Administrator'), adminReportsController.getPatientReport);
router.get('/reports/analytics/export', jwtAuth, requireRole('Hospital Administrator'), adminReportsController.exportReport);

router.get('/settings/hospital', jwtAuth, settingsController.getHospital);
router.put('/settings/hospital', jwtAuth, requireRole('Hospital Administrator'), settingsController.updateHospital);
router.get('/settings/features', jwtAuth, settingsController.getFeatures);
router.put('/settings/features', jwtAuth, requireRole('Hospital Administrator'), settingsController.updateFeatures);
router.get('/settings/account', jwtAuth, settingsController.getAccount);
router.put('/settings/account', jwtAuth, settingsController.updateAccount);
router.get('/settings/whatsapp', jwtAuth, settingsController.getWhatsApp);
router.put('/settings/whatsapp', jwtAuth, requireRole('Hospital Administrator'), settingsController.updateWhatsApp);
router.post('/settings/whatsapp/test', jwtAuth, requireRole('Hospital Administrator'), settingsController.testWhatsApp);

router.get('/settings/operating-hours', jwtAuth, scheduleController.getOperatingHours);
router.post('/settings/operating-hours/preview', jwtAuth, requireRole('Hospital Administrator'), scheduleController.previewOperatingHours);
router.put('/settings/operating-hours', jwtAuth, requireRole('Hospital Administrator'), scheduleController.saveOperatingHours);

router.get('/schedule-overrides', jwtAuth, scheduleController.listOverrides);
router.post('/schedule-overrides', jwtAuth, requireRole('Hospital Administrator'), scheduleController.createOverride);
router.patch('/schedule-overrides/:id/lift', jwtAuth, requireRole('Hospital Administrator'), scheduleController.liftOverride);

router.get('/schedule-audit-log', jwtAuth, scheduleController.getAuditLog);
router.get('/waiting-list', jwtAuth, scheduleController.listWaitingList);

// Staff Management — role changes/removal require Hospital Administrator
// (or Super Admin, which outranks it); a staff member can never act on
// their own account here (see staffAdminService's actingAdminId guards).
router.get('/staff', jwtAuth, requireRole('Hospital Administrator'), adminStaffController.list);
router.post('/staff', jwtAuth, requireRole('Hospital Administrator'), adminStaffController.create);
router.patch('/staff/:id/role', jwtAuth, requireRole('Hospital Administrator'), adminStaffController.updateRole);
router.delete('/staff/:id', jwtAuth, requireRole('Hospital Administrator'), adminStaffController.remove);

module.exports = router;
