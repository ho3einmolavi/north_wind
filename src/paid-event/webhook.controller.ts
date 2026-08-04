import { Body, Controller, Headers, Post } from '@nestjs/common';
import { PaidEventService } from './paid-event.service';

interface WebhookBody {
  id: string; // provider event id
  type: string;
  data: {
    eventId?: string;
    chargeId: string;
    amountCents: number;
  };
}

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly paidEvent: PaidEventService) {}

  // The mock provider POSTs here once a hold settles. It signs the body with the
  // shared HMAC secret (header `x-nw-signature`).
  @Post('payment')
  async payment(
    @Body() body: WebhookBody,
    @Headers('x-nw-signature') signature: string,
  ) {
    if (body.type === 'charge.settled') {
      return this.paidEvent.applyWebhook({
        eventId: body.data.eventId,
        providerEventId: body.id,
        chargeId: body.data.chargeId,
        amountCents: body.data.amountCents,
      });
    }
    return { ok: true, ignored: body.type };
  }
}
