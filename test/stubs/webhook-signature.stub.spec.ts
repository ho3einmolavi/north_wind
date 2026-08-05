import * as crypto from 'crypto';
import { DbService } from '../../src/common/db.service';

/**
 * STUB — defect NOT implemented. See repro_stubs.md § "Stub 1".
 *
 * /webhooks/payment accepts any signature. Remove `.skip` to run this against
 * the stack (`docker compose up`); it FAILS on current code and should PASS
 * once a WebhookSignatureGuard is added.
 *
 * Requires `NestFactory.create(AppModule, { rawBody: true })` in main.ts — the
 * guard must HMAC the raw bytes, not a re-serialized body.
 */

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_nw_local_dev_2f9c1a7b';
const PAYMENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CHARGE_ID = 'ch_seed_held_001';

function body(amountCents: number, id = 'evt_stub_001') {
  return JSON.stringify({
    id,
    type: 'charge.settled',
    data: { chargeId: CHARGE_ID, amountCents },
  });
}

function sign(raw: string) {
  return crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
}

describe.skip('[STUB] webhook signature verification', () => {
  const db = new DbService();

  beforeEach(async () => {
    await db.query(
      `UPDATE payments SET amount_cents = 4000, status = 'held' WHERE id = $1`,
      [PAYMENT_ID],
    );
  });

  afterAll(async () => {
    await db.pool.end();
  });

  async function amountOf() {
    const res = await db.query(`SELECT amount_cents FROM payments WHERE id = $1`, [
      PAYMENT_ID,
    ]);
    return res.rows[0].amount_cents;
  }

  it('rejects a forged signature with 401 and does not touch the money', async () => {
    const raw = body(999999);
    const res = await fetch(`${APP_URL}/webhooks/payment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nw-signature': 'totally-invalid-not-even-hex',
      },
      body: raw,
    });

    // current code: 201 + amount_cents becomes attacker-controlled (observed 1003999)
    expect(res.status).toBe(401);
    expect(await amountOf()).toBe(4000);
  });

  it('rejects a missing signature header with 401', async () => {
    const res = await fetch(`${APP_URL}/webhooks/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body(999999),
    });

    expect(res.status).toBe(401);
    expect(await amountOf()).toBe(4000);
  });

  it('accepts a correctly signed body', async () => {
    const raw = body(4000);
    const res = await fetch(`${APP_URL}/webhooks/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nw-signature': sign(raw) },
      body: raw,
    });

    expect(res.status).toBe(201);
    expect(await amountOf()).toBe(4000);
  });

  it('ignores a replayed provider event id', async () => {
    const raw = body(4000, 'evt_stub_replay');
    const headers = {
      'content-type': 'application/json',
      'x-nw-signature': sign(raw),
    };
    await fetch(`${APP_URL}/webhooks/payment`, { method: 'POST', headers, body: raw });
    await fetch(`${APP_URL}/webhooks/payment`, { method: 'POST', headers, body: raw });

    // A valid signature does not stop a captured payload being replayed;
    // providerEventId needs a unique index + ignore-on-conflict.
    expect(await amountOf()).toBe(4000);
  });
});
