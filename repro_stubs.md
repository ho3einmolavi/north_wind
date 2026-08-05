# Reproduction notes — top 2 defects NOT implemented

Both were verified against the running stack (Mode A). Failing-test stubs live in
`test/stubs/`, written as `describe.skip` so the suite stays green until someone picks
them up — remove the `.skip` to make them run (and fail) against current code.

---

## Stub 1 — `/webhooks/payment` never verifies the HMAC signature

**Severity:** critical. Unauthenticated, money-mutating, internet-reachable endpoint.

**Where:** `src/paid-event/webhook.controller.ts:20-34`. The handler takes
`@Headers('x-nw-signature') signature` and never uses it. The mock provider *does* sign
correctly (`mock-provider/server.js:17-19`, HMAC-SHA256 over the raw JSON with
`PAYMENT_WEBHOOK_SECRET`) — the app simply never checks.

### Exact repro

```bash
docker compose exec -T app npx ts-node db/seed.ts

curl -s -X POST http://localhost:3000/webhooks/payment \
  -H 'content-type: application/json' \
  -H 'x-nw-signature: totally-invalid-not-even-hex' \
  -d '{"id":"evt_forged_001","type":"charge.settled","data":{"chargeId":"ch_seed_held_001","amountCents":999999}}'

docker compose exec -T postgres psql -U northwind -d northwind -c \
  "SELECT id, status, amount_cents FROM payments WHERE provider_charge_id='ch_seed_held_001';"
```

### Observed (current code)

```
{"ok":true}

                  id                  | status | amount_cents
--------------------------------------+--------+--------------
 cccccccc-cccc-cccc-cccc-cccccccccccc | held   |      1003999
```

A garbage signature was accepted and moved the payment to **$10,039.99**.
(`1003999` = `4000 + 999999` on the pre-fix additive code; with the settlement fix in
place the same forged request instead *sets* the amount to `999999` — still fully
attacker-controlled, because the signature is still unchecked.)

### Intended assertions

- Forged/invalid signature → **HTTP 401**, `applyWebhook` **not** called,
  `amount_cents` **unchanged at 4000**.
- Missing `x-nw-signature` header entirely → **HTTP 401**, `amount_cents` unchanged.
- Correctly-signed body (HMAC-SHA256 of the **raw** bytes with
  `PAYMENT_WEBHOOK_SECRET`) → **HTTP 201**, processed normally.
- Signature comparison uses `crypto.timingSafeEqual`, not `===`.

### Implementation note (why this wasn't the one-line fix)

Verification needs the **raw request bytes**. `src/main.ts` does not enable `rawBody`,
and Nest has already JSON-parsed the body before the handler runs. Re-serializing with
`JSON.stringify(body)` is *not* guaranteed byte-identical to what the provider signed
(key ordering, whitespace), so the naive version produces a check that passes against
our own mock and rejects real provider traffic. Correct fix:
`NestFactory.create(AppModule, { rawBody: true })` + a `WebhookSignatureGuard` reading
`req.rawBody`. Add a replay guard at the same time (persist `providerEventId`, unique
index, ignore repeats) — signature validity alone does not stop a captured payload being
replayed.

---

## Stub 2 — No ownership check on any money-moving route

**Severity:** high. Any valid session token is a money-control plane over every host's events.

**Where:** `src/paid-event/paid-event.controller.ts`. Every handler calls
`await this.users.getActingUser(...)` — which only proves *a* valid token — and then
passes route params straight to the service. The resolved identity is never compared to
`events.host_id` or `payments.guest_id`/`host_id`. `AuthGuard` sets `req.principal` and
no handler reads it.

### Exact repro

Event `aaaaaaaa-…` is hosted by **host1**; its payment belongs to **guest1**.
All calls below act as **guest2**, a stranger to that event.

```bash
docker compose exec -T app npx ts-node db/seed.ts

# release + pay out another host's event
curl -s -X POST http://localhost:3000/events/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/release \
  -H "Authorization: Bearer token-guest2"

# check in a different guest
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:3000/events/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/checkin/33333333-3333-3333-3333-333333333333 \
  -H "Authorization: Bearer token-guest2"

# cancel someone else's event
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:3000/events/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cancel \
  -H "Authorization: Bearer token-guest2"

# refund $500.00 against a $40.00 payment, twice
curl -s -X POST http://localhost:3000/events/payments/cccccccc-cccc-cccc-cccc-cccccccccccc/refund \
  -H "Authorization: Bearer token-guest2" -H 'content-type: application/json' \
  -d '{"amountCents":50000}'
```

### Observed (current code)

```
{"released":["cccccccc-cccc-cccc-cccc-cccccccccccc"]}
 payment_status | event_status
----------------+--------------
 paid_out       | completed

201        <- checkin by a stranger
201        <- cancel by a stranger

{"paymentId":"cccccccc-...","refundedCents":50000}   <- $500 refund on a $40 payment
{"paymentId":"cccccccc-...","refundedCents":50000}   <- and again, already refunded
```

### Intended assertions

- `release` / `cancel` / `checkin` / `no-show` by a non-host → **HTTP 403**, event
  `status` stays `'open'`, payment `status` stays `'held'`.
- `release` by **host1** on their own event → **HTTP 201**, payment → `paid_out`.
- `refund` by a user who is neither the payment's host nor its guest → **HTTP 403**,
  payment `status` unchanged.
- `refund` with `amountCents` > `payments.amount_cents` → **HTTP 400**
  (`4000` payment, `50000` requested → rejected; refunded total never exceeds 4000).
- `refund` on a payment already `refunded` or `paid_out` → **HTTP 409**, no second
  provider call.

### Implementation note

Handlers should read `req.principal` (already populated by `AuthGuard`) rather than
re-resolving the token, then assert ownership in the service layer where the event/payment
row is already being loaded — so the check cannot be bypassed by a future caller that
skips the controller. Ship the state-machine guard on `refund` (defect #4 in the memo) in
the same change: authz and the amount/status guard protect different halves of the same
hole.
