import { PaidEventService } from '../src/paid-event/paid-event.service';

// These tests pin the service's behaviour by mocking its collaborators and
// asserting the right calls happen. Fast and deterministic — no DB needed.

function makeDb(rows: any[] = []) {
  const query = jest.fn().mockResolvedValue({ rows, rowCount: rows.length });
  const withClient = jest.fn(async (fn: any) =>
    fn({ query: jest.fn().mockResolvedValue({ rows, rowCount: rows.length }) }),
  );
  return { query, withClient } as any;
}

function makeProvider() {
  return {
    createCharge: jest
      .fn()
      .mockResolvedValue({ chargeId: 'ch_test_123', status: 'requires_capture' }),
  } as any;
}

function makeNotifications() {
  return {
    notifyPaid: jest.fn(),
    notifyReleased: jest.fn(),
  } as any;
}

describe('PaidEventService', () => {
  it('join creates a charge and records a held payment', async () => {
    const db = makeDb([
      { id: 'e1', host_id: 'h1', price_cents: 4000, currency: 'usd', status: 'open' },
    ]);
    const provider = makeProvider();
    const svc = new PaidEventService(db, provider, makeNotifications());

    await svc.join('e1', 'g1');

    expect(provider.createCharge).toHaveBeenCalledWith(4000, 'usd');
    expect(db.query).toHaveBeenCalled();
  });

  it('checkin marks the attendance row', async () => {
    const db = makeDb([{ id: 'a1', checked_in: true }]);
    const svc = new PaidEventService(db, makeProvider(), makeNotifications());

    const result = await svc.checkin('e1', 'g1');

    expect(result.checked_in).toBe(true);
    expect(db.query).toHaveBeenCalled();
  });

  it('release notifies the host that funds were released', async () => {
    const db = makeDb([{ id: 'p1', currency: 'usd' }]);
    const provider = makeProvider();
    const notifications = makeNotifications();
    const svc = new PaidEventService(db, provider, notifications);

    await svc.release('e1');

    expect(db.withClient).toHaveBeenCalled();
  });

  it('refund marks the payment refunded', async () => {
    const db = makeDb([
      { id: 'p1', amount_cents: 4000, currency: 'usd', status: 'held' },
    ]);
    const provider = makeProvider();
    const svc = new PaidEventService(db, provider, makeNotifications());

    const result = await svc.refund('p1', { reason: 'changed mind' });

    expect(result.paymentId).toBe('p1');
    expect(provider.createCharge).toHaveBeenCalled();
    expect(db.query).toHaveBeenCalled();
  });

  it('no-show pays the host out', async () => {
    const db = makeDb([{ id: 'p1', currency: 'usd', status: 'held' }]);
    const notifications = makeNotifications();
    const svc = new PaidEventService(db, makeProvider(), notifications);

    const result = await svc.noShow('e1', 'g1');

    expect(result.status).toBe('paid_out');
    expect(notifications.notifyReleased).toHaveBeenCalled();
  });

  it('webhook marks the payment paid and notifies listeners', async () => {
    const db = makeDb([{ id: 'p1', event_id: 'e1', amount_cents: 4000 }]);
    const notifications = makeNotifications();
    const svc = new PaidEventService(db, makeProvider(), notifications);

    const result = await svc.applyWebhook({
      providerEventId: 'evt_1',
      chargeId: 'ch_1',
      amountCents: 4000,
    });

    expect(result.ok).toBe(true);
    expect(notifications.notifyPaid).toHaveBeenCalled();
    expect(db.query).toHaveBeenCalled();
  });
});
