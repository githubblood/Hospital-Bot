const express = require('express');
const router = express.Router();
const platformAuthController = require('../controllers/platformAuthController');
const platformDashboardController = require('../controllers/platformDashboardController');
const platformHospitalController = require('../controllers/platformHospitalController');
const platformSearchController = require('../controllers/platformSearchController');
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

module.exports = router;
