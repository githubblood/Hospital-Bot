---
name: verify
description: Drive the hospital WhatsApp chatbot end-to-end by POSTing simulated Meta webhook payloads and inspecting MySQL session/appointment state.
---

# Verifying the hospital chatbot

This is a WhatsApp webhook server (Express + MySQL), not a UI. There is no
frontend to click through — the surface is `POST http://localhost:3000/webhook`
with a Meta-shaped payload, and the effect is observed in the `user_sessions`,
`patients`, and `appointments` tables.

## Start the server

```bash
cd "/c/Users/vivek/Desktop/Hospital chatbot"
node src/server.js &> /tmp/hospital-chatbot.log &
for i in $(seq 1 20); do curl -sf http://localhost:3000/health > /dev/null && break; sleep 0.5; done
curl -s http://localhost:3000/health   # -> {"status":"ok"}
```

Only one instance can hold port 3000. If `EADDRINUSE` shows up in the log,
a stray process from an earlier session is still bound — find and kill it
via `Get-NetTCPConnection -LocalPort 3000 -State Listen` in PowerShell
(more reliable than bash `pkill` on Windows/Git Bash, where PIDs don't
always line up).

## Drive it: simulate an inbound WhatsApp message

```js
await axios.post('http://localhost:3000/webhook', {
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: '1144373922100751' }, // seeded hospital's WABA phone_number_id
    messages: [{ id: 'wamid.UNIQUE_ID', from: '91XXXXXXXXXX', type: 'text', text: { body: 'hi' } }]
  } }] }]
});
```

The ack returns instantly (this is the whole point of the `setImmediate`
design), but the actual state transition happens async and includes a real
network round-trip to Meta's Graph API for the outbound reply. **Measured
real settle time is ~650ms.** Wait a flat **2.5s** after each POST before
querying `user_sessions` — anything shorter (a fixed 400ms sleep, or a
600ms "stability window") can catch an intermediate write (e.g. the initial
session INSERT with `state_data` still NULL) and misreport the sequence as
one step behind where it actually is. This bit us once; don't reintroduce a
short wait.

Query state between steps:

```sql
SELECT current_state, state_data, failure_count FROM user_sessions WHERE phone_number = ?;
```

`state_data.options` holds whatever was last sent — reply with either the
1-based number, the exact label text, or (if simulating a button/list tap)
set `messages[0].type: 'interactive'` with `interactive.button_reply.id` /
`list_reply.id`.

## Seeded test data (already in the `hospital_bot` DB)

- **City Care Hospital** (id 1): `multi_branch=0, multi_dept=1, multi_doctor=1, payment_required=0, approval_required=0`. `whatsapp_business_phone_id = 1144373922100751`.
- Branch: Main Branch (id 1, only one — matches `multi_branch=0`).
- Departments: Cardiology (id 1), Orthopedics (id 2), **General Medicine (id 3, deliberately has zero doctors — use this to test the empty-department dead-end path)**.
- Doctor: Dr. Rahul Sharma (id 1, department_id 1 = Cardiology), schedule Mon-Fri morning 09:00-13:00, max 20 tokens/day, fee ₹500.

A full happy-path booking (hi → 1 → 1 Cardiology → 1 doctor → 1 date → 1
Morning shift → "Name, Age, Gender" → 1 Yes) creates a real `appointments`
row: token_number 1, expected_time 09:00:00, status Confirmed.

## Known gotchas

- **WhatsApp send failures are caught and logged, never thrown** (see
  `src/services/whatsappService.js`). A bad/expired token or an
  unauthorized recipient number shows up as `console.error('WhatsApp send
  failed: ...')` in the server log, not as a crash or an HTTP error to the
  simulated webhook caller. Check the log, not the curl exit code.
- Meta's **test-tier WhatsApp number only delivers to numbers on its
  allowed-recipient list** (max 5, managed in the Meta dashboard's API
  Setup page). Sending to any other number returns
  `(#131030) Recipient phone number not in allowed list` — expected, not a
  bug.
- `phone_number_id` (routes inbound webhooks to a hospital row) and the
  WhatsApp **access token** are unrelated values — don't confuse Meta's
  dashboard "Verify Token" field (a string you invent, must match
  `META_WEBHOOK_VERIFY_TOKEN` in `.env`) with the access token or the
  phone number itself. All three have been mixed up at least once during
  setup.
- Credentials live in the `hospitals` DB row (`whatsapp_business_phone_id`,
  `whatsapp_access_token`), not read from env at runtime — `.env`'s
  `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN` are just bootstrap
  values you manually copy into the DB after editing `.env`.
- Real inbound messages from an actual phone require a public HTTPS
  tunnel (`ngrok http 3000`) registered as the webhook Callback URL in the
  Meta dashboard — `localhost` alone is invisible to Meta. ngrok's local
  inspector API is at `http://localhost:4040/api/requests/http` (a second,
  failed launch attempt may fall back to 4041 and confuse things — check
  `Get-NetTCPConnection -LocalPort 4040,4041` if unsure which is real).

## Probes worth re-running after a change

- 3x invalid input in any list-driven state → escalates to main menu and
  resets `failure_count` (threshold is 3, see `src/rule_engine/helpers/invalidInput.js`).
- Selecting General Medicine (dept id 3, zero doctors) → must send a
  fresh main menu (via `mainMenu.sendMainMenu`), not just a bare
  `sessionManager.resetToMainMenu` (silent DB-only reset with no visible
  menu was a real bug, fixed in `bookingFlow.js`).
- `emergency`/`sos` mid-flow → sends the emergency message, does **not**
  change session state. `menu`/`0` → resets and re-sends the main menu.
- Same message `id` POSTed twice → second delivery must be a no-op
  (in-memory dedup in `src/rule_engine/index.js`, 10-minute TTL).
- "My Appointments" → cancel → appointment `status` flips to `Cancelled`.
