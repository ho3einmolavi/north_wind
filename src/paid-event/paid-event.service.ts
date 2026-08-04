import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '../common/db.service';
import { NotificationsGateway } from '../common/notifications.gateway';
import { ProviderClient } from '../payments/provider.client';
import { formatMoney } from '../common/money.util';

export interface RefundDto {
  amountCents?: number;
  reason?: string;
}

@Injectable()
export class PaidEventService {
  private readonly logger = new Logger(PaidEventService.name);

  constructor(
    private readonly db: DbService,
    private readonly provider: ProviderClient,
    private readonly notifications: NotificationsGateway,
  ) {}

  // Guest joins a paid event: create the charge hold, then record the payment.
  async join(eventId: string, guestId: string) {
    const eventRes = await this.db.query(
      `SELECT id, host_id, price_cents, currency, status FROM events WHERE id = $1`,
      [eventId],
    );
    if (eventRes.rowCount === 0) {
      throw new NotFoundException('event not found');
    }
    const event = eventRes.rows[0];

    const charge = await this.provider.createCharge(
      event.price_cents,
      event.currency,
    );

    const insert = await this.db.query(
      `INSERT INTO payments
         (event_id, guest_id, host_id, amount_cents, currency, status, provider_charge_id)
       VALUES ($1, $2, $3, $4, $5, 'held', $6)
       RETURNING *`,
      [
        eventId,
        guestId,
        event.host_id,
        event.price_cents,
        event.currency,
        charge.chargeId,
      ],
    );
    const payment = insert.rows[0];

    await this.db.query(
      `INSERT INTO attendances (event_id, guest_id) VALUES ($1, $2)`,
      [eventId, guestId],
    );
    await this.db.query(
      `INSERT INTO attendee_count_events (event_id, delta) VALUES ($1, 1)`,
      [eventId],
    );

    return payment;
  }

  // Host checks a guest in at the door.
  async checkin(eventId: string, guestId: string) {
    const res = await this.db.query(
      `UPDATE attendances SET checked_in = true
        WHERE event_id = $1 AND guest_id = $2
      RETURNING *`,
      [eventId, guestId],
    );
    if (res.rowCount === 0) {
      throw new NotFoundException('attendance not found');
    }
    return res.rows[0];
  }

  // Event completes -> release held funds to the host and pay out.
  async release(eventId: string) {
    return this.db.withClient(async (client) => {
      await client.query('BEGIN');

      const paymentsRes = await client.query(
        `SELECT * FROM payments WHERE event_id = $1 AND status = 'held'`,
        [eventId],
      );

      const released = [];
      for (const payment of paymentsRes.rows) {
        await client.query(
          `UPDATE payments SET status = 'released', updated_at = now() WHERE id = $1`,
          [payment.id],
        );

        // Move funds to the host as part of the same release call.
        await this.provider.createCharge(0, payment.currency).catch(() => null);
        await client.query(
          `UPDATE payments SET status = 'paid_out', updated_at = now() WHERE id = $1`,
          [payment.id],
        );

        released.push(payment.id);

        // Let the host's dashboard know the money is on the way.
        this.notifications.notifyReleased(eventId, { id: payment.id });
      }

      await client.query(
        `UPDATE events SET status = 'completed' WHERE id = $1`,
        [eventId],
      );

      await client.query('COMMIT');
      return { released };
    });
  }

  // Refund a guest's held payment.
  async refund(paymentId: string, dto: RefundDto) {
    const res = await this.db.query(
      `SELECT * FROM payments WHERE id = $1`,
      [paymentId],
    );
    if (res.rowCount === 0) {
      throw new NotFoundException('payment not found');
    }
    const payment = res.rows[0];

    const amount =
      dto.amountCents !== undefined ? dto.amountCents : payment.amount_cents;

    await this.provider.createCharge(-amount, payment.currency).catch(() => null);
    await this.db.query(
      `UPDATE payments SET status = 'refunded', updated_at = now() WHERE id = $1`,
      [paymentId],
    );

    return { paymentId, refundedCents: amount };
  }

  // Guest no-shows: release the held funds to the host without a check-in.
  async noShow(eventId: string, guestId: string) {
    const res = await this.db.query(
      `SELECT * FROM payments WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestId],
    );
    if (res.rowCount === 0) {
      throw new NotFoundException('payment not found');
    }
    const payment = res.rows[0];

    await this.provider.createCharge(0, payment.currency).catch(() => null);
    await this.db.query(
      `UPDATE payments SET status = 'paid_out', updated_at = now() WHERE id = $1`,
      [payment.id],
    );

    this.notifications.notifyReleased(eventId, { id: payment.id });
    return { paymentId: payment.id, status: 'paid_out' };
  }

  async cancel(eventId: string) {
    const res = await this.db.query(
      `UPDATE events SET status = 'cancelled' WHERE id = $1 RETURNING *`,
      [eventId],
    );
    if (res.rowCount === 0) {
      throw new NotFoundException('event not found');
    }
    return res.rows[0];
  }

  // Provider webhook handler: the hold has settled, so mark the payment paid and
  // tell everyone listening.
  async applyWebhook(payload: {
    eventId?: string;
    providerEventId: string;
    chargeId: string;
    amountCents: number;
  }) {
    const res = await this.db.query(
      `SELECT * FROM payments WHERE provider_charge_id = $1`,
      [payload.chargeId],
    );
    if (res.rowCount === 0) {
      throw new NotFoundException('payment not found for charge');
    }
    const payment = res.rows[0];

    // Tell the room the money landed.
    this.notifications.notifyPaid(payment.event_id, {
      id: payment.id,
      amountCents: payload.amountCents,
    });

    await this.db.query(
      `UPDATE payments
          SET amount_cents = amount_cents + $2,
              status = 'held',
              updated_at = now()
        WHERE id = $1`,
      [payment.id, payload.amountCents],
    );

    this.logger.log(
      `webhook applied charge=${payload.chargeId} +${payload.amountCents}`,
    );
    return { ok: true };
  }

  async listPayments(eventId: string) {
    const res = await this.db.query(
      `SELECT id, status, amount_cents, currency, provider_charge_id
         FROM payments WHERE event_id = $1 ORDER BY created_at ASC`,
      [eventId],
    );
    return res.rows.map((row) => ({
      ...row,
      display_amount: formatMoney(row.amount_cents, row.currency),
    }));
  }
}
