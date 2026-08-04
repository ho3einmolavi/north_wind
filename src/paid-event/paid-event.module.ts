import { Module } from '@nestjs/common';
import { PaidEventController } from './paid-event.controller';
import { WebhookController } from './webhook.controller';
import { PaidEventService } from './paid-event.service';
import { AttendeeCountWorker } from './attendee-count.worker';
import { NotificationsGateway } from '../common/notifications.gateway';
import { TransactionalOutboxService } from '../common/transactional-outbox.service';
import { ProviderClient } from '../payments/provider.client';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [PaidEventController, WebhookController],
  providers: [
    PaidEventService,
    AttendeeCountWorker,
    NotificationsGateway,
    TransactionalOutboxService,
    ProviderClient,
  ],
  exports: [PaidEventService],
})
export class PaidEventModule {}
