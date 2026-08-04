import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PaidEventModule } from './paid-event/paid-event.module';

@Module({
  imports: [CommonModule, AuthModule, UsersModule, PaidEventModule],
})
export class AppModule {}
