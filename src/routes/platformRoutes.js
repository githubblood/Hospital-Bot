const express = require('express');
const router = express.Router();
const platformAuthController = require('../controllers/platformAuthController');
const platformDashboardController = require('../controllers/platformDashboardController');
const platformHospitalController = require('../controllers/platformHospitalController');
const platformSearchController = require('../controllers/platformSearchController');
const platformPlanController = require('../controllers/platformPlanController');
const platformSubscriptionController = require('../controllers/platformSubscriptionController');
const platformJwtAuth = require('../middleware/platformJwtAuth');
const { platformLoginLimiter } = require('../middleware/rateLimiters');

// Mounted separately at /api/platform in app.js — never nested under
// /api/admin — and every route below platformJwtAuth requires a
// token_type: 'platform_admin' JWT, which jwtAuth.js (the hospital-admin
// side) already independently refuses to accept. Neither token type can
// authenticate the other's routes, in either direction.
router.post('/login', platformLoginLimiter, platformAuthController.login);
router.post('/logout', platformAuthController.logout);

router.get('/dashboard/stats', platformJwtAuth, platformDashboardController.getStats);
router.get('/audit-log', platformJwtAuth, platformDashboardController.getAuditLog);
router.get('/settings', platformJwtAuth, platformDashboardController.getSettings);
router.get('/search', platformJwtAuth, platformSearchController.search);

router.get('/hospitals', platformJwtAuth, platformHospitalController.list);
router.get('/hospitals/:id', platformJwtAuth, platformHospitalController.getOne);
router.post('/hospitals', platformJwtAuth, platformHospitalController.create);
router.put('/hospitals/:id', platformJwtAuth, platformHospitalController.update);
router.patch('/hospitals/:id/suspend', platformJwtAuth, platformHospitalController.suspend);
router.patch('/hospitals/:id/activate', platformJwtAuth, platformHospitalController.activate);

// Stage 4C — Subscription & Licensing. Plan Management + per-hospital
// subscription assignment/lifecycle, all platform-admin-only via the same
// platformJwtAuth every route above already requires.
router.get('/plans', platformJwtAuth, platformPlanController.list);
router.get('/plans/:id', platformJwtAuth, platformPlanController.getOne);
router.post('/plans', platformJwtAuth, platformPlanController.create);
router.put('/plans/:id', platformJwtAuth, platformPlanController.update);
router.patch('/plans/:id/archive', platformJwtAuth, platformPlanController.archive);
router.patch('/plans/:id/restore', platformJwtAuth, platformPlanController.restore);

router.get('/subscriptions', platformJwtAuth, platformSubscriptionController.list);
router.get('/subscriptions/:hospitalId', platformJwtAuth, platformSubscriptionController.getOne);
router.get('/subscriptions/:hospitalId/history', platformJwtAuth, platformSubscriptionController.getHistory);
router.post('/subscriptions/:hospitalId/assign', platformJwtAuth, platformSubscriptionController.assign);
router.post('/subscriptions/:hospitalId/extend-trial', platformJwtAuth, platformSubscriptionController.extendTrial);
router.patch('/subscriptions/:hospitalId/activate', platformJwtAuth, platformSubscriptionController.activate);
router.patch('/subscriptions/:hospitalId/suspend', platformJwtAuth, platformSubscriptionController.suspend);
router.patch('/subscriptions/:hospitalId/reactivate', platformJwtAuth, platformSubscriptionController.reactivate);

module.exports = router;
