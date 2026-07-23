const { AsyncLocalStorage } = require('async_hooks');

// Carries the current message's preferred language ('en' | 'hi' | 'both')
// through to messages.js's bi() and optionMenu's sendOptionMenu without
// threading a language parameter through every one of the hundreds of M.xxx()
// call sites. AsyncLocalStorage (not a plain module-level variable) is what
// makes this safe under concurrency — two different phones' messages can be
// processed on overlapping ticks of the event loop, and a shared mutable
// variable would leak one phone's language into another's response.
const als = new AsyncLocalStorage();

function run(language, fn) {
    return als.run(language || 'both', fn);
}

// 'both' is the original bilingual behavior — used before a patient has
// chosen a language, and as the default for messages sent outside a
// request's context (e.g. an admin-triggered billing WhatsApp send).
function getLanguage() {
    return als.getStore() || 'both';
}

module.exports = { run, getLanguage };
