const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const verifyMetaSignature = require('../middleware/verifyMetaSignature');
const { webhookLimiter } = require('../middleware/rateLimiters');

router.get('/webhook', webhookController.verifyWebhook);
router.post('/webhook', webhookLimiter, verifyMetaSignature, webhookController.receiveMessage);

module.exports = router;
