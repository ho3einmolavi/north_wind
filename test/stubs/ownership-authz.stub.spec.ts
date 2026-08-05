import { DbService } from '../../src/common/db.service';

/**
 * STUB — defect NOT implemented. See repro_stubs.md § "Stub 2".
 *
 * No /events/* route checks ownership. Every handler proves only that *a* valid
 * token was presented, then passes route params straight to the service.
 * Remove `.skip` to run against the stack (`docker compose up`); these FAIL on
 * current code and should PASS once ownership checks land.
 */

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Seed fixtures: event AAAA is hosted by host1; its payment belongs to guest1.
// guest2 is a stranger to that event.
const EVENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PAYMENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PAID_OUT_PAYMENT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const GUEST1 = '33333333-3333-3333-3333-333333333333';
const STRANGER = 'token-guest2';
const HOST = 'token-host1';

function post(path: string, token: string, body?: unknown) {
  return fetch(`${APP_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe.skip('[STUB] ownership-aware authz on money-moving routes', () => {
  const db = new DbService();

  beforeEach(async () => {
    await db.query(
      `UPDATE payments SET amount_cents = 4000, status = 'held' WHERE id = $1`,
      [PAYMENT],
    );
    await db.query(
      `UPDATE payments SET amount_cents = 2500, status = 'paid_out' WHERE id = $1`,
      [PAID_OUT_PAYMENT],
    );
    await db.query(`UPDATE events SET status = 'open' WHERE id = $1`, [EVENT]);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  async function payment(id = PAYMENT) {
    const res = await db.query(
      `SELECT status, amount_cents FROM payments WHERE id = $1`,
      [id],
    );
    return res.rows[0];
  }

  async function eventStatus() {
    const res = await db.query(`SELECT status FROM events WHERE id = $1`, [EVENT]);
    return res.rows[0].status;
  }

  describe('a stranger must not move money', () => {
    it('cannot release another host\'s event', async () => {
      // current code: 201 + {"released":["cccc..."]}, payment -> paid_out
      const res = await post(`/events/${EVENT}/release`, STRANGER);

      expect(res.status).toBe(403);
      expect((await payment()).status).toBe('held');
      expect(await eventStatus()).toBe('open');
    });

    it('cannot cancel another host\'s event', async () => {
      const res = await post(`/events/${EVENT}/cancel`, STRANGER); // current: 201

      expect(res.status).toBe(403);
      expect(await eventStatus()).toBe('open');
    });

    it('cannot check in another host\'s guest', async () => {
      const res = await post(`/events/${EVENT}/checkin/${GUEST1}`, STRANGER); // current: 201

      expect(res.status).toBe(403);
      const rows = await db.query(
        `SELECT checked_in FROM attendances WHERE event_id = $1 AND guest_id = $2`,
        [EVENT, GUEST1],
      );
      expect(rows.rows[0].checked_in).toBe(false);
    });

    it('cannot no-show another host\'s guest into a payout', async () => {
      const res = await post(`/events/${EVENT}/no-show/${GUEST1}`, STRANGER);

      expect(res.status).toBe(403);
      expect((await payment()).status).toBe('held');
    });

    it('cannot refund a payment it neither owns nor hosts', async () => {
      const res = await post(`/events/payments/${PAYMENT}/refund`, STRANGER, {
        reason: 'not mine',
      });

      expect(res.status).toBe(403);
      expect((await payment()).status).toBe('held');
    });
  });

  describe('the legitimate host still works', () => {
    it('releases its own event', async () => {
      const res = await post(`/events/${EVENT}/release`, HOST);

      expect(res.status).toBe(201);
      expect((await payment()).status).toBe('paid_out');
      expect(await eventStatus()).toBe('completed');
    });
  });

  describe('refund state machine + amount cap', () => {
    it('rejects a refund larger than the payment', async () => {
      // current code: 201 {"refundedCents":50000} on a 4000 payment
      const res = await post(`/events/payments/${PAYMENT}/refund`, HOST, {
        amountCents: 50000,
      });

      expect(res.status).toBe(400);
      expect((await payment()).status).toBe('held');
      expect((await payment()).amount_cents).toBe(4000);
    });

    it('rejects a second refund of the same payment', async () => {
      await post(`/events/payments/${PAYMENT}/refund`, HOST, { amountCents: 4000 });
      const res = await post(`/events/payments/${PAYMENT}/refund`, HOST, {
        amountCents: 4000,
      });

      expect(res.status).toBe(409); // current code: 201, refunds twice
    });

    it('rejects refunding an already paid-out payment', async () => {
      const res = await post(`/events/payments/${PAID_OUT_PAYMENT}/refund`, HOST, {
        reason: 'clawback',
      });

      expect(res.status).toBe(409); // current code: 201, flips paid_out -> refunded
      expect((await payment(PAID_OUT_PAYMENT)).status).toBe('paid_out');
    });
  });
});
