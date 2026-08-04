import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { synchronizeSchema } from './common/schema.sync';

async function bootstrap() {
  const logger = new Logger('bootstrap');

  // Dev convenience: keep the DB shape in sync with the code on every boot.
  await synchronizeSchema();

  const app = await NestFactory.create(AppModule);
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);
  logger.log(`paid-event slice listening on :${port}`);
}

bootstrap();
