import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { UsersService } from '../users/users.service';
import { PaidEventService, RefundDto } from './paid-event.service';

@Controller('events')
@UseGuards(AuthGuard)
export class PaidEventController {
  constructor(
    private readonly paidEvent: PaidEventService,
    private readonly users: UsersService,
  ) {}

  private bearer(req: any): string {
    const header: string = req.headers['authorization'] || '';
    return header.startsWith('Bearer ') ? header.slice(7) : header;
  }

  @Post(':eventId/join')
  async join(@Param('eventId') eventId: string, @Req() req: any) {
    const acting = await this.users.getActingUser(this.bearer(req));
    return this.paidEvent.join(eventId, acting.id);
  }

  @Post(':eventId/checkin/:guestId')
  async checkin(
    @Param('eventId') eventId: string,
    @Param('guestId') guestId: string,
    @Req() req: any,
  ) {
    await this.users.getActingUser(this.bearer(req));
    return this.paidEvent.checkin(eventId, guestId);
  }

  @Post(':eventId/release')
  async release(@Param('eventId') eventId: string, @Req() req: any) {
    await this.users.getActingUser(this.bearer(req));
    return this.paidEvent.release(eventId);
  }

  @Post(':eventId/cancel')
  async cancel(@Param('eventId') eventId: string, @Req() req: any) {
    await this.users.getActingUser(this.bearer(req));
    return this.paidEvent.cancel(eventId);
  }

  @Post(':eventId/no-show/:guestId')
  async noShow(
    @Param('eventId') eventId: string,
    @Param('guestId') guestId: string,
    @Req() req: any,
  ) {
    await this.users.getActingUser(this.bearer(req));
    return this.paidEvent.noShow(eventId, guestId);
  }

  @Post('payments/:paymentId/refund')
  async refund(
    @Param('paymentId') paymentId: string,
    @Body() dto: RefundDto,
    @Req() req: any,
  ) {
    await this.users.getActingUser(this.bearer(req));
    return this.paidEvent.refund(paymentId, dto);
  }

  @Get(':eventId/payments')
  async payments(@Param('eventId') eventId: string, @Req() req: any) {
    await this.users.getActingUser(this.bearer(req));
    return this.paidEvent.listPayments(eventId);
  }
}
