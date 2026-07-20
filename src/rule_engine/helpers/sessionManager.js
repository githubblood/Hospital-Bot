const db = require('../../config/db');

const DEFAULT_STATE = 'STATE_MAIN_MENU';

// user_sessions is keyed only by phone_number (no hospital_id in the PK), so a
// number can only ever be mid-conversation with one hospital at a time. If the
// same number messages a *different* hospital's WABA number than the one on
// record, we treat it as a fresh context and reset the session.
async function getOrCreateSession(phoneNumber, hospitalId) {
    const [rows] = await db.query('SELECT * FROM user_sessions WHERE phone_number = ?', [phoneNumber]);

    if (rows.length === 0) {
        await db.query(
            'INSERT INTO user_sessions (phone_number, hospital_id, current_state, state_data, failure_count) VALUES (?, ?, ?, NULL, 0)',
            [phoneNumber, hospitalId, DEFAULT_STATE]
        );
        return { phone_number: phoneNumber, hospital_id: hospitalId, current_state: DEFAULT_STATE, state_data: null, failure_count: 0, preferred_language: null };
    }

    const session = rows[0];
    if (session.hospital_id !== hospitalId) {
        await db.query(
            'UPDATE user_sessions SET hospital_id = ?, current_state = ?, state_data = NULL, failure_count = 0 WHERE phone_number = ?',
            [hospitalId, DEFAULT_STATE, phoneNumber]
        );
        return { phone_number: phoneNumber, hospital_id: hospitalId, current_state: DEFAULT_STATE, state_data: null, failure_count: 0, preferred_language: session.preferred_language };
    }

    if (typeof session.state_data === 'string') {
        session.state_data = session.state_data ? JSON.parse(session.state_data) : null;
    }
    return session;
}

// stateData, when provided, REPLACES state_data (callers pass the full object they want kept).
async function transitionState(phoneNumber, newState, stateData = null) {
    await db.query(
        'UPDATE user_sessions SET current_state = ?, state_data = ?, failure_count = 0 WHERE phone_number = ?',
        [newState, stateData ? JSON.stringify(stateData) : null, phoneNumber]
    );
}

async function resetToMainMenu(phoneNumber) {
    await transitionState(phoneNumber, DEFAULT_STATE, null);
}

// Updates state_data without touching current_state or failure_count — used
// when re-sending/refreshing the menu for the *current* state (e.g. after an
// invalid reply) so the failure streak that triggers escalation isn't reset.
async function updateStateData(phoneNumber, stateData) {
    await db.query('UPDATE user_sessions SET state_data = ? WHERE phone_number = ?', [
        stateData ? JSON.stringify(stateData) : null,
        phoneNumber
    ]);
}

// Lives on its own column rather than inside state_data specifically so it
// survives transitionState/resetToMainMenu, which replace state_data wholesale.
async function setPreferredLanguage(phoneNumber, language) {
    await db.query('UPDATE user_sessions SET preferred_language = ? WHERE phone_number = ?', [language, phoneNumber]);
}

async function incrementFailure(phoneNumber) {
    await db.query('UPDATE user_sessions SET failure_count = failure_count + 1 WHERE phone_number = ?', [phoneNumber]);
    const [rows] = await db.query('SELECT failure_count FROM user_sessions WHERE phone_number = ?', [phoneNumber]);
    return rows[0]?.failure_count || 0;
}

module.exports = {
    DEFAULT_STATE,
    getOrCreateSession,
    transitionState,
    resetToMainMenu,
    setPreferredLanguage,
    incrementFailure
};
