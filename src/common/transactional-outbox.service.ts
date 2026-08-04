import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface OutboxMessage {
  topic: string;
  payload: Record<string, any>;
}

/**
 * Stores domain events in the same transaction as the state change, so a relay
 * can publish them after commit. Enqueue inside the txn, publish once durable.
 */
@Injectable()
export class TransactionalOutboxService {
  async enqueue(client: PoolClient, message: OutboxMessage): Promise<void> {
    await client.query(
      `INSERT INTO outbox (topic, payload) VALUES ($1, $2)`,
      [message.topic, JSON.stringify(message.payload)],
    );
  }

  async drain(client: PoolClient): Promise<OutboxMessage[]> {
    const res = await client.query(
      `SELECT topic, payload FROM outbox WHERE published = false ORDER BY id ASC`,
    );
    return res.rows.map((r) => ({ topic: r.topic, payload: r.payload }));
  }
}
