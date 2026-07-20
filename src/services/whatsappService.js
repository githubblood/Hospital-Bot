const axios = require('axios');
require('dotenv').config();

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v20.0';

function graphUrl(phoneNumberId) {
    return `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
}

async function callGraphApi(hospital, payload) {
    try {
        await axios.post(
            graphUrl(hospital.whatsapp_business_phone_id),
            { messaging_product: 'whatsapp', ...payload },
            { headers: { Authorization: `Bearer ${hospital.whatsapp_access_token}` } }
        );
    } catch (err) {
        console.error('WhatsApp send failed:', err.response?.data || err.message);
    }
}

// Plain text message.
async function sendText(hospital, toPhone, body) {
    await callGraphApi(hospital, {
        to: toPhone,
        type: 'text',
        text: { body }
    });
}

// Up to 3 quick-reply buttons. buttons: [{ id, title }]
async function sendButtons(hospital, toPhone, bodyText, buttons) {
    await callGraphApi(hospital, {
        to: toPhone,
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: bodyText },
            action: {
                buttons: buttons.slice(0, 3).map(b => ({
                    type: 'reply',
                    reply: { id: b.id, title: b.title.slice(0, 20) }
                }))
            }
        }
    });
}

// Up to 10 rows. rows: [{ id, title, description }]
async function sendList(hospital, toPhone, headerText, bodyText, buttonLabel, rows) {
    await callGraphApi(hospital, {
        to: toPhone,
        type: 'interactive',
        interactive: {
            type: 'list',
            header: { type: 'text', text: headerText },
            body: { text: bodyText },
            action: {
                button: buttonLabel,
                sections: [
                    {
                        title: headerText,
                        rows: rows.slice(0, 10).map(r => ({
                            id: r.id,
                            title: r.title.slice(0, 24),
                            description: (r.description || '').slice(0, 72)
                        }))
                    }
                ]
            }
        }
    });
}

module.exports = { sendText, sendButtons, sendList };
