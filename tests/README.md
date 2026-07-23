# Tests

There is no automated test suite (no Jest/Mocha/etc.) in this project yet. Verification
so far has always been done against the real running app and a real database:

- **Syntax**: `node --check <file>` on anything touched.
- **Backend/API**: direct `curl`/Node scripts against the live dev server and database,
  following the request → response → DB-row chain for real (not mocked).
- **WhatsApp bot**: simulated Meta webhook payloads POSTed to `/webhook`, then inspecting
  `user_sessions`/`patients`/`appointments` state — see `.claude/skills/verify/SKILL.md`
  for the exact method, seeded test data, and known gotchas (timing, dedup, etc.).
- **Admin panel UI**: Playwright (`npm install --no-save playwright`, not a tracked
  dependency), driving real login → page interactions, asserting zero console errors and
  no horizontal overflow across the supported breakpoints.

Any test data created during verification (patients, appointments, admin accounts, etc.)
is deleted again afterward — nothing here is meant to persist as fixture data.

If this project adds a real automated suite in the future, that's genuinely new tooling —
this file documents the current, actual practice rather than a placeholder for one.
