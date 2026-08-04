# p1-paid-event-slice

A small slice of Northwind's paid-event backend: a guest joins a paid meetup →
funds are **held** → the host checks the guest in → the event **completes** →
funds **release / pay out**, with **refund / no-show** paths.

Stack: **NestJS** (TypeScript) · **Postgres 15** · **Redis** · a **mock payment
provider** that emits HMAC-signed settlement webhooks · **Jest**.

> This README covers setup and how to run only. See the take-home handout for
> what you're being asked to deliver.

---

## Layout

```
src/
  auth/         token -> principal resolution + route guard
  users/        user profiles
  paid-event/   join / checkin / release / refund / no-show / webhook + worker
  payments/     mock-provider client
  common/       db + redis + notifications + utilities
db/             schema.sql + seed.ts + helpers
mock-provider/  standalone mock payment provider (POST /charges -> webhook)
test/           Jest suite
reproduce_bugs.sh
```

## Prerequisites

- Docker + Docker Compose (Mode A), **or** Node 20 + a local Postgres/Redis.
- `openssl` and `curl` on your PATH if you want to run `reproduce_bugs.sh`.

## Configuration

Copy the example env file. The defaults work as-is with Docker Compose:

```bash
cp .env.example .env
```

Key values:

- `PAYMENT_WEBHOOK_SECRET` — shared HMAC secret between the mock provider and the app.
- `AUTH_LOOKUP_DELAY_MS` — simulated cross-service latency for the auth lookup.
- `ATTENDEE_COUNT_WORKER_ENABLED` — toggles the attendee-count read-model worker.

## Run with Docker (Mode A)

```bash
make up          # builds + starts Postgres, Redis, the app, and the mock provider
# (in another shell, once the app logs "listening on :3000")
make repro       # runs reproduce_bugs.sh against the running stack
```

`make up` applies `db/schema.sql`, seeds fixtures (`db/seed.ts`), and starts the
app on `http://localhost:3000`. The mock provider listens on
`http://localhost:4000`.

Offline / mirror helpers:

- `make load` — loads arch-matched offline image tarballs if present
  (`images-amd64.tar.gz` / `images-arm64.tar.gz`), otherwise builds from source.
- See `SETUP.md` for the npm-mirror / registry path.

## Run without Docker (Mode B)

```bash
npm install
# point the PG*/REDIS_* env vars at your local services, then:
npm run seed          # loads fixtures
npm run start:dev     # starts the app on :3000
node mock-provider/server.js   # in another shell
```

If you cannot run Docker at all, note it in `setup_issue.md` and reason from
source per the handout.

## Seed fixtures

`db/seed.ts` inserts (fixed UUIDs/tokens so you can reference exact rows):

- two hosts, two guests, with bearer tokens `token-host1` / `token-host2` /
  `token-guest1` / `token-guest2` (in `auth_sessions`);
- event **`aaaaaaaa-…`** "Rooftop Sunset Mixer" ($40.00) with one **held** payment;
- event **`bbbbbbbb-…`** "Morning Trail Run" ($25.00), already **completed / paid out**.

## Auth

Routes under `/events/*` are guarded. Pass a seeded token:

```bash
curl -H "Authorization: Bearer token-guest1" \
  http://localhost:3000/events/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/payments
```

## HTTP surface

| Method & path | What it does |
|---|---|
| `POST /events/:eventId/join` | Guest joins; creates a hold + held payment |
| `POST /events/:eventId/checkin/:guestId` | Host checks a guest in |
| `POST /events/:eventId/release` | Event completes; release/pay out held funds |
| `POST /events/:eventId/cancel` | Cancel the event |
| `POST /events/:eventId/no-show/:guestId` | No-show path for a guest |
| `POST /events/payments/:paymentId/refund` | Refund a payment |
| `GET  /events/:eventId/payments` | List payments for an event |
| `POST /webhooks/payment` | Settlement webhook from the mock provider |

## Tests

```bash
npm test
```

## Reproduce script

```bash
./reproduce_bugs.sh   # or: make repro
```

It reseeds, prints payment rows, delivers one settlement webhook, lists
payments again, and times a guarded route over five calls. It is a neutral
starting point — assemble your own scenarios from there.
