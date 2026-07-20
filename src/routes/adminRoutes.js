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
const adminAuth = require('../middleware/adminAuth');
const jwtAuth = require('../middleware/jwtAuth');
const uploadLogo = require('../middleware/uploadLogo');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimiters');

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
router.post('/forgot-password', adminAuthController.forgotPassword);
router.post('/reset-password', adminAuthController.resetPassword);
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

router.get('/doctors', jwtAuth, adminDoctorsController.list);
router.get('/doctors/:id', jwtAuth, adminDoctorsController.getOne);
router.post('/doctors', jwtAuth, adminDoctorsController.create);
router.put('/doctors/:id', jwtAuth, adminDoctorsController.update);
router.patch('/doctors/:id/leave', jwtAuth, adminDoctorsController.toggleLeave);
router.delete('/doctors/:id', jwtAuth, adminDoctorsController.remove);

router.get('/departments', jwtAuth, adminDepartmentsController.list);

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

router.get('/settings/hospital', jwtAuth, settingsController.getHospital);
router.put('/settings/hospital', jwtAuth, settingsController.updateHospital);
router.get('/settings/features', jwtAuth, settingsController.getFeatures);
router.put('/settings/features', jwtAuth, settingsController.updateFeatures);
router.get('/settings/account', jwtAuth, settingsController.getAccount);
router.put('/settings/account', jwtAuth, settingsController.updateAccount);
router.get('/settings/whatsapp', jwtAuth, settingsController.getWhatsApp);
router.put('/settings/whatsapp', jwtAuth, settingsController.updateWhatsApp);
router.post('/settings/whatsapp/test', jwtAuth, settingsController.testWhatsApp);

module.exports = router;
