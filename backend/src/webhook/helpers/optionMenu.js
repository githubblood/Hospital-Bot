const whatsappService = require('../../services/whatsappService');
// M (not a destructured MENU_FOOTER) — MENU_FOOTER is a getter that reads the
// current language from langContext, so it must be read fresh at call time,
// not destructured once when this module first loads (see messages.js).
const M = require('../messages');
const { getLanguage } = require('./langContext');

// Renders a numbered menu as plain text (English label, Hindi label, or both
// combined depending on the current language — see langContext), an optional
// description line, and a number-emoji bullet. Plain text — not WhatsApp
// interactive buttons/lists — so bilingual text fits (interactive titles cap
// at 20-24 chars) and matches the clinic's reference style. Replies are
// resolved by number/label in resolveSelection, so no free-text interpretation
// is involved.
async function sendOptionMenu(hospital, phone, headerText, options) {
    const lang = getLanguage();
    const lines = options.map((opt, idx) => {
        const emoji = M.NUM_EMOJI[idx] || `${idx + 1}.`;
        let label;
        if (lang === 'en') label = opt.label;
        else if (lang === 'hi') label = opt.labelHi || opt.label;
        else label = opt.labelHi ? `${opt.label} (${opt.labelHi})` : opt.label;

        let line = `${emoji} ${label}`;
        if (opt.description) line += `\n     ${opt.description}`;
        return line;
    });

    const bodyText = `${headerText}\n\n${lines.join('\n')}\n\n${M.MENU_FOOTER}`;
    await whatsappService.sendText(hospital, phone, bodyText);

    return options;
}

// Resolves a user's reply against the options list that was last sent for this
// session (session.state_data.options). Accepts, in order: the interactive
// reply id, a 1-based numeric index, or a case-insensitive exact label match.
function resolveSelection(options, incomingText, interactiveId) {
    if (!options || options.length === 0) return null;

    if (interactiveId) {
        const byId = options.find(opt => opt.id === interactiveId);
        if (byId) return byId;
    }

    const trimmed = (incomingText || '').trim();

    if (/^\d+$/.test(trimmed)) {
        const idx = parseInt(trimmed, 10) - 1;
        if (idx >= 0 && idx < options.length) return options[idx];
        return null;
    }

    const byLabel = options.find(opt => opt.label.toLowerCase() === trimmed.toLowerCase());
    if (byLabel) return byLabel;

    return null;
}

module.exports = { sendOptionMenu, resolveSelection };
