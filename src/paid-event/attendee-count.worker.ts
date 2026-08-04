import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DbService } from '../common/db.service';

/**
 * Read-model worker. Consumes attendee_count_events (our local event-stream
 * stand-in) and folds them into events.attendee_count so reads stay fast.
 * Designed to be swapped for a Kafka consumer group later.
 */
@Injectable()
export class AttendeeCountWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttendeeCountWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: DbService) {}

  onModuleInit() {
    if (process.env.ATTENDEE_COUNT_WORKER_ENABLED === 'false') {
      return;
    }
    this.timer = setInterval(() => this.tick().catch(() => null), 1000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async tick() {
    const res = await this.db.query(
      `SELECT id, event_id, delta FROM attendee_count_events
        WHERE processed = false ORDER BY id ASC LIMIT 100`,
    );
    for (const row of res.rows) {
      await this.db.query(
        `UPDATE events SET attendee_count = attendee_count + $2 WHERE id = $1`,
        [row.event_id, row.delta],
      );
      await this.db.query(
        `UPDATE attendee_count_events SET processed = true WHERE id = $1`,
        [row.id],
      );
    }
    if (res.rowCount > 0) {
      this.logger.log(`folded ${res.rowCount} attendee_count event(s)`);
    }
  }
}
