import { Injectable, Logger } from '@nestjs/common';
import { generateIdempotencyKey } from '../common/idempotency.util';

export interface ChargeResult {
  chargeId: string;
  status: string;
}

/**
 * Thin client over the mock payment provider. POST /charges creates a hold;
 * the provider later emits POST /webhooks/payment once the hold settles.
 */
@Injectable()
export class ProviderClient {
  private readonly logger = new Logger(ProviderClient.name);
  private readonly baseUrl =
    process.env.PAYMENT_PROVIDER_URL || 'http://localhost:4000';

  async createCharge(amountCents: number, currency: string): Promise<ChargeResult> {
    const idempotencyKey = generateIdempotencyKey('charge');
    const res = await fetch(`${this.baseUrl}/charges`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ amountCents, currency }),
    });
    const body = (await res.json()) as ChargeResult;
    this.logger.log(`charge created id=${body.chargeId} status=${body.status}`);
    return body;
  }
}
