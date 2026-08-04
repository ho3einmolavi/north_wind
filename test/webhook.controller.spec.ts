import { WebhookController } from '../src/paid-event/webhook.controller';

describe('WebhookController', () => {
  function makeSvc() {
    return { applyWebhook: jest.fn().mockResolvedValue({ ok: true }) } as any;
  }

  it('applies a charge.settled event', async () => {
    const svc = makeSvc();
    const controller = new WebhookController(svc);

    const res = await controller.payment(
      {
        id: 'evt_1',
        type: 'charge.settled',
        data: { chargeId: 'ch_1', amountCents: 4000 },
      },
      'sig_abc',
    );

    expect(svc.applyWebhook).toHaveBeenCalled();
    expect(res).toEqual({ ok: true });
  });

  it('ignores unrelated event types', async () => {
    const svc = makeSvc();
    const controller = new WebhookController(svc);

    const res = await controller.payment(
      { id: 'evt_2', type: 'charge.created', data: { chargeId: 'ch_2', amountCents: 0 } },
      'sig_abc',
    );

    expect(svc.applyWebhook).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, ignored: 'charge.created' });
  });
});
