# evidence.md

## Bug: webhook settlement treats `amountCents` as additive, not authoritative

**File**: `src/paid-event/paid-event.service.ts`, `applyWebhook()`.

### 1. Empirical repro against the real running stack (`./reproduce_bugs.sh`, Mode A / Docker)

Seeded payment `cccccccc-...` starts at `amount_cents = 4000` ("held", $40.00).
One single, correctly-signed settlement webhook (`amountCents: 4000`) is delivered
by the script — not a duplicate, just the normal happy path:

```
== (2) Payments for the held event (current state) ==
                  id                  | status | amount_cents | provider_charge_id
--------------------------------------+--------+--------------+--------------------
 cccccccc-cccc-cccc-cccc-cccccccccccc | held   |         4000 | ch_seed_held_001
(1 row)

== (3) Deliver one settlement webhook for the held charge ==
{"ok":true}

== (4) Payments for the held event (after the webhook) ==
                  id                  | status | amount_cents | provider_charge_id
--------------------------------------+--------+--------------+--------------------
 cccccccc-cccc-cccc-cccc-cccccccccccc | held   |         8000 | ch_seed_held_001
(1 row)
```

`amount_cents` doubled ($40.00 -> $80.00) after a single legitimate webhook. Root
cause: `UPDATE payments SET amount_cents = amount_cents + $2 ...` treats the
provider's confirmed settled total as a delta to add on top of the existing
value, instead of the authoritative amount.

### 2. Predicted failure values (written before running the characterization test)

- After 1 webhook delivery (`amountCents=4000`): `amount_cents` -> **8000**.
- After a 2nd delivery (retry/duplicate, same charge/amount): `amount_cents` -> **12000**.
- After the fix: both deliveries leave `amount_cents` at **4000** (idempotent).

### 3. Characterization test — RED (before fix), real Postgres via `npx jest test/webhook-settlement.integration.spec.ts`

```
[Nest] LOG [PaidEventService] webhook applied charge=ch_seed_held_001 +4000
[Nest] LOG [PaidEventService] webhook applied charge=ch_seed_held_001 +4000
[Nest] LOG [PaidEventService] webhook applied charge=ch_seed_held_001 +4000
FAIL test/webhook-settlement.integration.spec.ts
  applyWebhook settlement handling (real DB)
    ✕ does not inflate amount_cents on a single webhook delivery (40 ms)
    ✕ is idempotent when the same settlement is delivered twice (7 ms)

  ● applyWebhook settlement handling (real DB) › does not inflate amount_cents on a single webhook delivery

    expect(received).toBe(expected) // Object.is equality

    Expected: 4000
    Received: 8000

  ● applyWebhook settlement handling (real DB) › is idempotent when the same settlement is delivered twice

    expect(received).toBe(expected) // Object.is equality

    Expected: 4000
    Received: 12000

Test Suites: 1 failed, 1 total
Tests:       2 failed, 2 total
```

Matches the predicted failure values exactly (8000, then 12000).

### 4. Fix applied

Flag-guarded change in `applyWebhook` (`WEBHOOK_SETTLEMENT_FIX_ENABLED`, default
`true`): sets `amount_cents` to the provider's confirmed settled total instead of
adding to it, and no longer regresses `status` back to `'held'` for a payment
already in a terminal state (`released` / `paid_out` / `refunded`). Setting
`WEBHOOK_SETTLEMENT_FIX_ENABLED=false` restores the exact old behavior for
instant rollback, with no redeploy of a new code path needed.

### 5. Characterization test — GREEN (after fix)

```
[Nest] LOG [PaidEventService] webhook applied charge=ch_seed_held_001 +4000
[Nest] LOG [PaidEventService] webhook applied charge=ch_seed_held_001 +4000
[Nest] LOG [PaidEventService] webhook applied charge=ch_seed_held_001 +4000
PASS test/webhook-settlement.integration.spec.ts
  applyWebhook settlement handling (real DB)
    ✓ does not inflate amount_cents on a single webhook delivery (86 ms)
    ✓ is idempotent when the same settlement is delivered twice (6 ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

### 6. Full suite — no regressions

```
PASS test/money.util.spec.ts
PASS test/auth.guard.spec.ts
PASS test/webhook.controller.spec.ts
PASS test/paid-event.service.spec.ts
PASS test/webhook-settlement.integration.spec.ts

Test Suites: 5 passed, 5 total
Tests:       19 passed, 19 total
```

### 7. Rollback proof — flag off reproduces the original bug exactly

`WEBHOOK_SETTLEMENT_FIX_ENABLED=false npx jest test/webhook-settlement.integration.spec.ts`:

```
Expected: 4000
Received: 8000
...
Expected: 4000
Received: 12000

Test Suites: 1 failed, 1 total
Tests:       2 failed, 2 total
```

Confirms the flag genuinely toggles between old and new behavior (true
reversibility, not just cosmetic).

### 8. End-to-end proof through the real HTTP path (rebuilt container)

The strongest form of the "how do you handle *one* duplicate webhook" question —
three deliveries of the same correctly-signed settlement, through the running app
container, against the real Postgres:

```
--- before ---
held | 4000
after webhook delivery #1:
held | 4000
after webhook delivery #2:
held | 4000
after webhook delivery #3:
held | 4000
```

Before the fix the same sequence produced `4000 → 8000 → 12000 → 16000`.
The amount is now pinned to the provider's confirmed settled total and redelivery is
a genuine no-op.

> Note: `docker-compose.yml` loads the app's `env_file` from **`.env.example`**, not
> `.env`, so the flag was added to both files. Worth knowing before the live demo —
> editing only `.env` would have no effect on the container.

### Diff size

```
git diff --stat
 .env.example                         |  2 ++
 src/paid-event/paid-event.service.ts | 33 +++++++++++++++++++++++++--------
 2 files changed, 27 insertions(+), 8 deletions(-)
```

27 insertions / 8 deletions in the fix itself — under the 50-line target
(the new test file is separate, additive, and not counted against that budget).
