import {
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
@WebSocketGateway({ cors: true })
export class NotificationsGateway {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server: Server;

  notifyPaid(eventId: string, payment: { id: string; amountCents: number }) {
    this.logger.log(`payment.paid event=${eventId} payment=${payment.id}`);
    if (this.server) {
      this.server.emit('payment.paid', { eventId, payment });
    }
  }

  notifyReleased(eventId: string, payment: { id: string }) {
    this.logger.log(`payment.released event=${eventId} payment=${payment.id}`);
    if (this.server) {
      this.server.emit('payment.released', { eventId, payment });
    }
  }
}
