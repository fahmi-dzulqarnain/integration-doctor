import 'reflect-metadata';
import { type INestApplication, Module, ValidationPipe, type DynamicModule } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import helmet from 'helmet';
import { APP_CONFIG, type AppConfig } from './config.js';
import { ChecksController, HealthController, ProbeController } from './controllers.js';
import { ProbeService } from './probe/probe.service.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ThrottlerModule.forRoot([
        { name: 'default', ttl: 60_000, limit: config.rateLimitPerMinute },
        // Only the probe uses this one (see ProbeController); everything else skips it.
        { name: 'probe', ttl: 3_600_000, limit: config.probePerClientPerHour },
      ])],
      controllers: [ChecksController, ProbeController, HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        ProbeService,
      ],
    };
  }
}

/** Builds the app with everything main.ts and the tests share. */
export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    // Request bodies may hold credentials, so only startup and errors are logged.
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '600kb' });
  app.disable('x-powered-by');
  // A hop count, not a list of trusted networks: Docker's gateway is a private address too, so
  // trusting private networks would let any client choose its own X-Forwarded-For.
  app.set('trust proxy', config.trustProxyHops);
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('Integration Doctor for DHL APIs')
    .setDescription('Checks DHL API requests and explains DHL errors. Not affiliated with DHL.')
    .setVersion('0.1.0')
    .build());
  SwaggerModule.setup('api/docs', app, document);
  return app;
}
