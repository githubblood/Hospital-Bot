const STATES = require('../states');
const sessionManager = require('../helpers/sessionManager');
const { sendOptionMenu, resolveSelection } = require('../helpers/optionMenu');
const { handleInvalidInput } = require('../helpers/invalidInput');
const langContext = require('../helpers/langContext');
const mainMenu = require('./mainMenu');
const M = require('../messages');

// Asked once per phone number, before the very first main menu — not asked
// again afterward since preferred_language lives on its own session column
// that transitionState/resetToMainMenu never touch.
async function sendLanguagePrompt(hospital, phone) {
    const options = await sendOptionMenu(hospital, phone, M.languagePrompt, M.languageOptions);
    await sessionManager.transitionState(phone, STATES.SELECT_LANGUAGE, { options });
}

async function handle(hospital, phone, session, incoming) {
    const options = session.state_data?.options || M.languageOptions;
    const selected = resolveSelection(options, incoming.text, incoming.interactiveId);

    if (!selected) {
        await handleInvalidInput(
            hospital, phone,
            M.languagePrompt, options,
            M.invalidLanguage,
            async () => {
                // Escalation fallback: don't force a choice after repeated
                // invalid replies, and don't loop them on the language prompt
                // forever either — default to English and reset silently. The
                // escalation message handleInvalidInput just sent already
                // covers "let's start over"; resending the full greeting right
                // behind it read as redundant. The menu still shows next time
                // they type anything.
                await sessionManager.setPreferredLanguage(phone, 'en');
                await sessionManager.resetToMainMenu(phone);
            }
        );
        return;
    }

    const language = selected.id === 'lang_hi' ? 'hi' : 'en';
    await sessionManager.setPreferredLanguage(phone, language);
    // The outer langContext for this message was entered with the OLD
    // preference (null -> 'both', read before the user chose) — re-enter it
    // with the new choice so this very first main menu isn't bilingual.
    await langContext.run(language, () => mainMenu.sendMainMenu(hospital, phone));
}

module.exports = { sendLanguagePrompt, handle };
