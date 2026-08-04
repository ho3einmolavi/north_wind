#!/usr/bin/env bash
# Smoke/verification helper for the paid-event slice.
# Brings the data to a known state and prints what's actually in the DB, plus a
# quick latency sample on a guarded route. It is a STARTING POINT for your own
# verification — assemble your own scenarios and read what the DB really does;
# do not trust the green test suite.
set -uo pipefail

APP_URL="${APP_URL:-http://localhost:3000}"
PROVIDER_URL="${PROVIDER_URL:-http://localhost:4000}"
WEBHOOK_SECRET="${PAYMENT_WEBHOOK_SECRET:-whsec_nw_local_dev_2f9c1a7b}"

# Seed fixtures (fixed UUIDs/tokens — see db/seed.ts).
EVENT_HELD="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
GUEST1_TOKEN="token-guest1"
HOST1_TOKEN="token-host1"
SEED_CHARGE_ID="ch_seed_held_001"

PSQL=(docker compose exec -T postgres psql -U northwind -d northwind)

hr() { printf '%s\n' "------------------------------------------------------------"; }

echo "== (1) Reseed =="
docker compose exec -T app npx ts-node db/seed.ts

hr
echo "== (2) Payments for the held event (current state) =="
"${PSQL[@]}" -c \
  "SELECT id, status, amount_cents, provider_charge_id FROM payments WHERE event_id = '${EVENT_HELD}';"

hr
echo "== (3) Deliver one settlement webhook for the held charge =="
RAW="$(printf '{"id":"evt_smoke_001","type":"charge.settled","data":{"chargeId":"%s","amountCents":4000}}' "$SEED_CHARGE_ID")"
SIG="$(printf '%s' "$RAW" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')"
curl -s -X POST "${APP_URL}/webhooks/payment" \
  -H 'content-type: application/json' \
  -H "x-nw-signature: ${SIG}" \
  -d "$RAW"
echo

hr
echo "== (4) Payments for the held event (after the webhook) =="
"${PSQL[@]}" -c \
  "SELECT id, status, amount_cents, provider_charge_id FROM payments WHERE event_id = '${EVENT_HELD}';"

hr
echo "== (5) Latency of a guarded route (5 samples, host token) =="
for i in 1 2 3 4 5; do
  START=$(date +%s%3N)
  curl -s -o /dev/null -X GET "${APP_URL}/events/${EVENT_HELD}/payments" \
    -H "Authorization: Bearer ${HOST1_TOKEN}"
  END=$(date +%s%3N)
  echo "request #$i: $((END - START)) ms"
done

echo
echo "Done. This is just a starting view of the running system — design your own"
echo "checks from here."
