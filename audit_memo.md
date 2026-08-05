# Audit memo — Northwind paid-event slice

**Mode A (Docker).** Everything below was verified against the running Postgres, not
inferred from the (green) Jest suite. The suite passes 19/19 while the system
double-charges every guest — it asserts *that collaborators were called*, never *what
the money ended up as*. Raw output in `evidence.md`.

---

## Ranked defects

### 1. CRITICAL — Settlement webhook treats `amountCents` as a delta, not the settled total. **[FIXED]**
`paid-event.service.ts:applyWebhook` did `SET amount_cents = amount_cents + $2`. The
provider sends the *confirmed total* for the charge, so the normal happy path doubles
every payment. Verified end-to-end through the real mock provider: three joins on a
$40.00 event produced `sum(amount_cents) = 24000` ($240.00) instead of $120.00 — the
provider's own settlement callback inflated each $40 hold to $80 with no attacker and
no duplicate involved. Redelivery (which real PSPs do on any timeout) compounds
further: $40 → $80 → $120.

**Why at launch:** 100% incidence, silent, and it corrupts the *ledger* rather than
failing loudly. Every payout, refund and reconciliation downstream reads a number that
was never what the guest was charged. Unwinding this after a week of live traffic means
reconstructing true amounts from provider records for every payment — far more
expensive than the fix. It also unconditionally reset `status` to `'held'`, so a
delayed webhook could resurrect an already `paid_out` payment.

**Fix shipped:** set `amount_cents` to the settled total; never regress a terminal
status (`released` / `paid_out` / `refunded`). Guarded by
`WEBHOOK_SETTLEMENT_FIX_ENABLED` (default `true`), 27 insertions / 8 deletions.
Characterization test proven RED (8000, then 12000) → GREEN (4000, 4000) against real
Postgres; flag off reproduces the original values exactly.

### 2. CRITICAL — `/webhooks/payment` never verifies the HMAC signature. *(stub only)*
The controller accepts `x-nw-signature` and ignores it. A forged POST with
`x-nw-signature: totally-invalid-not-even-hex` was accepted and moved the seeded
payment to **$10,039.99**. This is an unauthenticated, internet-reachable, money-mutating
endpoint.

**Why not fixed first:** doing it *correctly* needs the raw request bytes.
`main.ts` has no `rawBody` and Nest has already parsed the JSON by the time the handler
runs; re-serializing with `JSON.stringify` is not byte-identical to what the provider
signed (key order/whitespace), so a naive 6-line fix yields a check that passes in tests
and fails in production. The honest version touches `main.ts` bootstrap + a guard, which
is a different blast radius than the one-file fix above. It is the **next** change to
ship, this week, not a backlog item. Stub in `repro_stubs.md`.

### 3. HIGH — No ownership check on any money-moving route.
Every `/events/*` handler calls `getActingUser()` (authN) and never asks whether the
caller owns the event or the payment (authZ). Verified as `token-guest2`, a stranger to
event `aaaa…`: released and paid out host1's funds (`{"released":["cccc…"]}`, event →
`completed`), checked in another guest (HTTP 201), and cancelled the event (HTTP 201).
Same token also refunded **$500.00 against a $40.00 payment**, refunded it a second time,
and clawed back an already-`paid_out` payment on an unrelated event.

**Why at launch:** any valid session token — every guest has one — is a full money-control
plane over every other host's events. One leaked or scripted token drains the platform.

### 4. HIGH — `refund()` has no amount cap and no state machine.
Accepts `amountCents` straight from the body (no comparison to `amount_cents`), and no
guard on current status. Confirmed refunding $500 on a $40 payment, double-refunding,
and refunding a `paid_out` payment. Compounds #3, but is a defect on its own even with
correct authz.

### 5. MEDIUM — `join()` is not idempotent, and `release()` calls the provider inside the transaction.
Three POSTs to `/join` created three holds and three `attendances` rows for one guest —
a double-tapped button charges the guest twice. Separately, `release()` performs an
outbound `provider.createCharge()` between `BEGIN` and `COMMIT` and fires
`notifyReleased` before commit: a slow provider holds a write transaction open per
payment, and a rollback still emits "your money is on the way." `.catch(() => null)`
on the payout call means a failed transfer still marks the row `paid_out`.

---

## Right-size DOWN

**Delete the transactional outbox and the attendee-count worker.**

`TransactionalOutboxService` is registered as a provider in `paid-event.module.ts`, but
`enqueue()` and `drain()` are **called from nowhere**. The `outbox` table has 0 rows and
structurally always will. It is scaffolding for a message bus that does not exist.

`attendee-count.worker.ts` polls `attendee_count_events` every second to fold `+1`
deltas into `events.attendee_count`, and is documented as "designed to be swapped for a
Kafka consumer group later." It maintains **one integer** that `SELECT count(*) FROM
attendances` answers exactly, and it does so *less* correctly: the `UPDATE events` and
`UPDATE … SET processed = true` are two separate statements, so a crash between them
double-counts on restart. It is an eventually-consistent read model protecting a value
nobody has measured as slow.

Both should go, along with the `outbox` and `attendee_count_events` tables. That removes
a table, a worker, a poll loop and a whole consistency failure mode — and the correctness
budget it frees is exactly what defects 2–4 need. Per the brief I did not *add*
infrastructure; I am flagging that the slice should also *shed* some.

---

## auth ↔ users consolidation — cutover sketch

Today `AuthGuard` resolves the token to a principal, then `getActingUser()` resolves the
**same token again** and loads the profile — two lookups per guarded request, each paying
`AUTH_LOOKUP_DELAY_MS`. Measured floor on `GET /events/:id/payments`: ~98–142 ms for what
is one indexed join. The guard already attaches `req.principal`; controllers ignore it.

*Prerequisite, ~5 lines, ship immediately:* read `req.principal` in controllers instead of
re-resolving. Halves auth latency and removes the second failure mode, with no schema change.

**1 · Schema-merge.** `auth_sessions.user_id` already FKs `users.id`. Introduce one
canonical read path — a `session_principals` view (or a single JOIN behind
`AuthService.resolvePrincipal`) returning `user_id, role, email, display_name` in one
round trip. Additive only; nothing drops.

**2 · Dual-write.** Session create/revoke writes to both the existing `auth_sessions` and
the consolidated store, behind `AUTH_CONSOLIDATION_DUAL_WRITE`. Reads unchanged. Old store
stays authoritative, so this step is a no-op to users and reversible by flag.

**3 · Backfill.** Copy historical sessions in batches, then run a reconciliation job to
`COUNT`/checksum both stores until the delta is 0 and *stays* 0 across a full session TTL.
Alert on non-zero delta — that alert is the go/no-go gate for step 4.

**4 · Flip.** Move reads to the consolidated path behind `AUTH_CONSOLIDATED_READS`, ramped
1% → 10% → 50% → 100%. Dual-write stays on throughout. Watch auth p99, 401 rate, and
`resolvePrincipal` null-rate against the pre-flip baseline.

**5 · Rollback.** Flip `AUTH_CONSOLIDATED_READS` off — instant, because dual-write kept the
old store current the entire time; there is no reverse backfill. Only after ~2 weeks clean
do we stop dual-writing and drop `auth_sessions`. That drop is the first irreversible step
and gets its own change window.

**Monitoring for the shipped fix:** alert on any `payments` row where `amount_cents`
diverges from its event's `price_cents`, and on any webhook that targets a payment already
in a terminal state — both are zero-volume today and would have caught defect #1 on day one.
