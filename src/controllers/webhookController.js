require('dotenv').config();
const ruleEngine = require('../rule_engine/index');

// Meta calls this once, at webhook setup time, to prove ownership.
exports.verifyWebhook = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
};

function extractIncoming(messageData) {
    switch (messageData.type) {
        case 'text':
            return { text: messageData.text.body, interactiveId: null };
        case 'button':
            // Quick-reply button from a template message.
            return { text: messageData.button?.text || '', interactiveId: null };
        case 'interactive': {
            const reply = messageData.interactive?.list_reply || messageData.interactive?.button_reply;
            return { text: reply?.title || '', interactiveId: reply?.id || null };
        }
        default:
            return { text: '', interactiveId: null };
    }
}

// Meta expects a 200 within 5s. We ack immediately and hand off the actual
// rule-engine work to setImmediate so nothing synchronous (DB, Graph API
// calls) sits in front of the response.
exports.receiveMessage = (req, res) => {
    const body = req.body;
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const messageData = value?.messages?.[0];

    if (!body.object || !messageData) {
        return res.sendStatus(200);
    }

    const userPhone = messageData.from;
    const phoneNumberId = value.metadata?.phone_number_id;
    const incoming = extractIncoming(messageData);
    const messageId = messageData.id;

    res.status(200).send('EVENT_RECEIVED');

    setImmediate(async () => {
        try {
            await ruleEngine.handleIncomingMessage(userPhone, phoneNumberId, incoming, messageId);
        } catch (err) {
            console.error('Rule engine error:', err);
        }
    });
};
