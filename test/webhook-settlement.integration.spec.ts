import { DbService } from '../src/common/db.service';
import { PaidEventService } from '../src/paid-event/paid-event.service';

// Characterization test for the webhook settlement bug: applyWebhook treats
// the provider's `amountCents` as a delta to ADD to the payment's amount_cents
// instead of the confirmed settled total, so every delivery (not just a
// duplicate) inflates the ledger. Requires the real Postgres from
// `docker compose up` reachable at localhost:5432 (default DbService config
// matches docker-compose.yml's exposed port + credentials).
//
// Predicted BEFORE running, against current (unfixed) code:
//   - after 1 webhook delivery (amountCents=4000):  amount_cents = 8000
//   - after a 2nd delivery (retry/duplicate, same amountCents=4000): amount_cents = 12000
// Predicted AFTER the fix (WEBHOOK_SETTLEMENT_FIX_ENABLED=true, the default):
//   - after 1 delivery: amount_cents = 4000
//   - after a 2nd delivery: amount_cents stays 4000 (idempotent)

const PAYMENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CHARGE_ID = 'ch_seed_held_001';

function makeNotifications() {
  return { notifyPaid: jest.fn(), notifyReleased: jest.fn() } as any;
}

function makeProvider() {
  return { createCharge: jest.fn() } as any;
}

describe('applyWebhook settlement handling (real DB)', () => {
  const db = new DbService();
  const svc = new PaidEventService(db, makeProvider(), makeNotifications());

  beforeEach(async () => {
    await db.query(
      `UPDATE payments SET amount_cents = 4000, status = 'held', updated_at = now() WHERE id = $1`,
      [PAYMENT_ID],
    );
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('does not inflate amount_cents on a single webhook delivery', async () => {
    await svc.applyWebhook({
      providerEventId: 'evt_test_1',
      chargeId: CHARGE_ID,
      amountCents: 4000,
    });

    const res = await db.query(
      `SELECT amount_cents, status FROM payments WHERE id = $1`,
      [PAYMENT_ID],
    );
    expect(res.rows[0].amount_cents).toBe(4000);
    expect(res.rows[0].status).toBe('held');
  });

  it('is idempotent when the same settlement is delivered twice', async () => {
    await svc.applyWebhook({
      providerEventId: 'evt_test_1',
      chargeId: CHARGE_ID,
      amountCents: 4000,
    });
    await svc.applyWebhook({
      providerEventId: 'evt_test_2',
      chargeId: CHARGE_ID,
      amountCents: 4000,
    });

    const res = await db.query(
      `SELECT amount_cents FROM payments WHERE id = $1`,
      [PAYMENT_ID],
    );
    expect(res.rows[0].amount_cents).toBe(4000);
  });
});
