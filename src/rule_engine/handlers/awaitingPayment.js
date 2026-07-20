const whatsappService = require('../../services/whatsappService');
const M = require('../messages');

// Payment confirmation happens out-of-band (staff hits the admin
// confirm-payment endpoint), so any inbound message here just re-sends the
// reminder. The user can still escape via the global 'menu'/'emergency' overrides.
async function handle(hospital, phone, session) {
    const reminder = session.state_data?.reminder || M.awaitingPaymentDefault;
    await whatsappService.sendText(hospital, phone, reminder);
}

module.exports = { handle };
